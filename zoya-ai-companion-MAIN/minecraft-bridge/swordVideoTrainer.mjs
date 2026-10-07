#!/usr/bin/env node
/**
 * ZOYA Sword PvP Video Trainer
 * Local video -> sampled frames -> Groq vision observations -> structured Sword skills.
 * It never connects to Minecraft and never controls the bot.
 *
 * Vision-rate-limit design:
 * - Qwen 3.8 27B charges 2048 input tokens per image.
 * - Analyze several sampled frames in one contact-sheet image so the trainer
 *   uses one image charge per batch instead of one API request per frame.
 * - Each panel is mapped back to its original frame index and checkpointed.
 * - Existing observations remain resumable after 429s or interruption.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = path.resolve(process.env.ZOYA_PVP_TRAINING_DIR || "./minecraft-training");
const VIDEO_DIR = path.resolve(process.argv[2] || path.join(ROOT, "videos"));
const OUT_DIR = path.join(ROOT, "sword");
const FRAMES_DIR = path.join(OUT_DIR, "frames");
const CONTACT_DIR = path.join(OUT_DIR, "contact-sheets");
const OBS_FILE = path.join(OUT_DIR, "observations.json");
const SKILLS_FILE = path.join(OUT_DIR, "sword-skills.json");
const MODEL = process.env.ZOYA_VISION_MODEL || "qwen/qwen3.8-27b";
const API_KEY = process.env.GROQ_API_KEY;
const FPS = Math.max(0.05, Number(process.env.ZOYA_TRAIN_FPS || 0.125));
const MAX_BYTES = 19 * 1024 * 1024;
const VISION_INPUT_ESTIMATE = 2048;
const RETRIES = 5;
const SHEET_FRAMES = Math.max(2, Math.min(6, Number(process.env.ZOYA_TRAIN_SHEET_FRAMES || 6)));
const MAX_RETRY_WAIT_MS = 65000;
const SKILL_SCHEMA = [
  "movement","spacing","sprint_reset","attack_timing","crit_timing",
  "combo_control","target_tracking","repositioning","defense",
  "healing","disengagement","recovery"
];

let remainingInputTokens = null;
let resetAtMs = 0;

function fail(message) {
  console.error("\n[SWORD-TRAIN] ERROR: " + message);
  process.exitCode = 1;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDurationMs(value) {
  if (!value) return 0;
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1000;
  let total = 0;
  const re = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let match;
  while ((match = re.exec(text))) {
    const n = Number(match[1]);
    if (match[2] === "ms") total += n;
    else if (match[2] === "s") total += n * 1000;
    else if (match[2] === "m") total += n * 60000;
    else total += n * 3600000;
  }
  return total;
}

async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => stdout += d);
    child.stderr.on("data", d => stderr += d);
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || command + " exited " + code));
    });
  });
}

async function requireFfmpeg() {
  try {
    await run("ffmpeg", ["-version"]);
    await run("ffprobe", ["-version"]);
  } catch {
    throw new Error("ffmpeg and ffprobe are required on PATH.");
  }
}

async function durationSeconds(video) {
  const out = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    video
  ]);
  const n = Number.parseFloat(out.trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Could not read duration: " + video);
  }
  return n;
}

async function sampleVideo(video) {
  const id = createHash("sha1").update(video).digest("hex").slice(0, 10);
  const dir = path.join(FRAMES_DIR, id);
  // Frame directories are generated artifacts. Clear stale samples first so
  // changing FPS cannot leave old JPEGs mixed with the new sample set.
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const duration = await durationSeconds(video);
  const pattern = path.join(dir, "frame-%06d.jpg");

  // Use the configured sampling density and keep frames modest in size.
  // Groq charges a fixed 2048 input tokens per image for Qwen 3.8 27B, so
  // shrinking the JPEG does not remove the image-token charge.
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", video,
    "-vf", "fps=" + FPS + ",scale=960:-2:force_original_aspect_ratio=decrease",
    "-q:v", "5",
    "-y", pattern
  ]);

  const files = (await fs.readdir(dir))
    .filter(x => x.endsWith(".jpg"))
    .sort();

  return {
    video,
    duration,
    files: files.map(x => path.join(dir, x))
  };
}

async function makeContactSheet(items, videoName) {
  const id = createHash("sha1")
    .update(videoName + "::" + items.map(x => x.frameIndex).join(","))
    .digest("hex").slice(0, 12);
  const listFile = path.join(CONTACT_DIR, id + ".txt");
  const output = path.join(CONTACT_DIR, id + ".jpg");
  await fs.mkdir(CONTACT_DIR, { recursive: true });
  await fs.writeFile(listFile, items.map(x => "file '" + x.file.replace(/'/g, "'\\''") + "'").join("\n"));
  const cols = Math.min(3, items.length);
  const rows = Math.ceil(items.length / cols);
  try {
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-f", "concat", "-safe", "0", "-i", listFile,
      "-vf", "tile=" + cols + "x" + rows + ":padding=8:margin=8",
      "-frames:v", "1", "-q:v", "4", "-y", output
    ]);
  } finally {
    await fs.rm(listFile, { force: true });
  }
  const stat = await fs.stat(output);
  if (stat.size > MAX_BYTES) throw new Error("Contact sheet exceeds API image limit: " + output);
  return output;
}

async function imageDataUrl(file) {
  const data = await fs.readFile(file);
  if (data.length > MAX_BYTES) {
    throw new Error("Sampled image exceeds API image limit: " + file);
  }
  return "data:image/jpeg;base64," + data.toString("base64");
}

function estimateInputTokens(messages) {
  let tokens = 0;
  for (const message of messages || []) {
    const content = message.content;
    if (typeof content === "string") {
      tokens += Math.ceil(content.length / 4);
      continue;
    }
    for (const item of content || []) {
      if (item.type === "image_url") tokens += 2048;
      else if (item.type === "text") tokens += Math.ceil(String(item.text || "").length / 4);
    }
  }
  return Math.max(1, tokens);
}

function updateRateHeaders(headers) {
  const remaining = Number.parseInt(headers.get("x-ratelimit-remaining-tokens") || "", 10);
  if (Number.isFinite(remaining)) remainingInputTokens = remaining;

  const reset = parseDurationMs(headers.get("x-ratelimit-reset-tokens"));
  if (reset > 0) resetAtMs = Date.now() + reset;
}

async function waitForRateBudget(estimatedTokens) {
  if (
    Number.isFinite(remainingInputTokens) &&
    remainingInputTokens < estimatedTokens &&
    resetAtMs > Date.now()
  ) {
    const waitMs = resetAtMs - Date.now() + 750;
    console.log(
      "\n[SWORD-TRAIN] Groq input-token budget low (" +
      remainingInputTokens + " remaining); waiting " +
      Math.ceil(waitMs / 1000) + "s..."
    );
    await sleep(waitMs);
    remainingInputTokens = null;
    resetAtMs = 0;
  }
}

async function groqJson(messages, maxTokens) {
  const estimatedTokens = estimateInputTokens(messages);

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    await waitForRateBudget(estimatedTokens);

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.2,
        reasoning_effort: "none",
        max_completion_tokens: maxTokens,
        response_format: { type: "json_object" }
      })
    });

    updateRateHeaders(res.headers);

    if (res.ok) {
      const json = await res.json();
      const raw = json.choices?.[0]?.message?.content;
      if (!raw) throw new Error("Groq returned no content.");
      return JSON.parse(raw);
    }

    const body = await res.text();
    if (res.status !== 429 || attempt === RETRIES) {
      throw new Error("Groq HTTP " + res.status + ": " + body);
    }

    const retryHeader = parseDurationMs(res.headers.get("retry-after"));
    const requestedWait = retryHeader || Math.max(2000, resetAtMs - Date.now() + 750);
    const retryMs = Math.min(requestedWait, MAX_RETRY_WAIT_MS);
    console.log(
      "\n[SWORD-TRAIN] Groq 429; retrying in " +
      Math.ceil(retryMs / 1000) + "s (" + attempt + "/" + RETRIES + ")" +
      (requestedWait > retryMs ? " (server delay capped)" : "") + "..."
    );
    await sleep(retryMs);
    remainingInputTokens = null;
    resetAtMs = 0;
  }

  throw new Error("Groq request failed after retries.");
}

async function visionSheet(file, videoName, items) {
  const mapping = items.map((x, i) => "panel " + (i + 1) + " = frame " + x.frameIndex).join(", ");
  const content = [{
    type: "text",
    text:
      "Analyze this Minecraft Java Sword PvP contact sheet. Panels are in reading order. " +
      mapping + ". Compare adjacent panels where possible. Report only visually supported reusable combat behavior. " +
      "Do not invent key presses or hidden game state. Return JSON exactly: " +
      "{frames:[{frameStart,observations:[{skill,confidence,evidence,likely_goal,timing_notes}]}]}. " +
      "Include one frames entry per panel, even if observations is empty. " +
      "skill must be one of: " + SKILL_SCHEMA.join(", ") + ". Video=" + videoName
  }, {
    type: "image_url",
    image_url: { url: await imageDataUrl(file) }
  }];
  return groqJson([{ role: "user", content }], 1200);
}

async function loadObservations() {
  try {
    const parsed = JSON.parse(await fs.readFile(OBS_FILE, "utf8"));
    return Array.isArray(parsed.observations) ? parsed.observations : [];
  } catch {
    return [];
  }
}

async function saveObservations(observations) {
  await fs.writeFile(
    OBS_FILE,
    JSON.stringify({
      version: 2,
      kit: "sword",
      model: MODEL,
      fps: FPS,
      generatedAt: new Date().toISOString(),
      observations
    }, null, 2)
  );
}

function observationKey(item) {
  const fps = item.fps == null ? "legacy" : String(item.fps);
  return String(item.video) + "::fps=" + fps + "::" + String(item.frameStart);
}

async function synthesize(observations) {
  // Vision analysis is the expensive Groq stage. Do not make a second chain of
  // LLM calls for synthesis: on free-tier TPM this can immediately 429 after
  // the video pass. Build a conservative, evidence-preserving skill library
  // locally from the already-analyzed observations.
  const grouped = new Map();

  for (const item of observations) {
    for (const obs of (item.result?.observations || [])) {
      const skill = String(obs.skill || "").trim();
      if (!SKILL_SCHEMA.includes(skill)) continue;

      const confidence = Number(obs.confidence);
      const entry = {
        skill,
        confidence: Number.isFinite(confidence) ? confidence : 0.5,
        evidence: String(obs.evidence || "").trim(),
        likely_goal: String(obs.likely_goal || "").trim(),
        timing_notes: String(obs.timing_notes || "").trim(),
        video: item.video,
        frameStart: item.frameStart
      };

      if (!grouped.has(skill)) grouped.set(skill, []);
      grouped.get(skill).push(entry);
    }
  }

  const skills = [];
  for (const skill of SKILL_SCHEMA) {
    const entries = grouped.get(skill);
    if (!entries?.length) continue;

    entries.sort((x, y) => y.confidence - x.confidence);
    const top = entries.slice(0, 8);
    const confidence = top.reduce((sum, x) => sum + x.confidence, 0) / top.length;

    const evidence = [...new Set(
      top.map(x => x.evidence).filter(Boolean)
    )].slice(0, 5);

    const goals = [...new Set(
      top.map(x => x.likely_goal).filter(Boolean)
    )].slice(0, 3);

    const timing = [...new Set(
      top.map(x => x.timing_notes).filter(Boolean)
    )].slice(0, 4);

    skills.push({
      id: "video-" + skill,
      name: skill.replace(/_/g, " "),
      skill,
      description:
        "Visually observed Sword PvP behavior for " + skill.replace(/_/g, " ") +
        "; apply conservatively only when the combat state supports it.",
      when_to_use: goals.join("; ") || "when the observed combat situation matches this behavior",
      avoid_when: "when spacing, target state, or timing is not visually supported",
      confidence: Number(confidence.toFixed(3)),
      evidence,
      implementation: {
        attackDistanceCeiling: 3.05,
        preferredDistanceRange: null,
        holdMsRange: null,
        maxDistance: 3.05,
        minDistance: null
      },
      sourceFrames: top.map(x => ({
        video: x.video,
        frameStart: x.frameStart
      })),
      timing_notes: timing
    });
  }

  return { skills };
}

async function main() {
  console.log("=== ZOYA Sword PvP Video Trainer ===");
  if (!API_KEY) throw new Error("GROQ_API_KEY is not set.");

  await requireFfmpeg();
  await fs.mkdir(FRAMES_DIR, { recursive: true });
  await fs.mkdir(CONTACT_DIR, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const names = (await fs.readdir(VIDEO_DIR))
    .filter(x => /\.(mp4|mkv|webm|mov)$/i.test(x));

  if (!names.length) throw new Error("No videos found in " + VIDEO_DIR);

  const observations = await loadObservations();
  const completed = new Set(observations.map(observationKey));

  for (const name of names) {
    const sampled = await sampleVideo(path.join(VIDEO_DIR, name));
    console.log(
      "[SWORD-TRAIN] " + name + " | " +
      sampled.duration.toFixed(1) + "s | " +
      sampled.files.length + " frames"
    );

    const pending = [];
    for (let i = 0; i < sampled.files.length; i++) {
      const key = name + "::fps=" + FPS + "::" + i;
      if (!completed.has(key)) pending.push({ file: sampled.files[i], frameIndex: i });
    }

    for (let offset = 0, batch = 0; offset < pending.length; offset += SHEET_FRAMES, batch++) {
      const items = pending.slice(offset, offset + SHEET_FRAMES);
      const sheet = await makeContactSheet(items, name);
      process.stdout.write(
        "  analyzing frames " + items[0].frameIndex + "-" +
        items[items.length - 1].frameIndex + " (" + items.length + " panels)\r"
      );
      const result = await visionSheet(sheet, name, items);
      const byFrame = new Map(
        (Array.isArray(result?.frames) ? result.frames : []).map(x => [Number(x.frameStart), x])
      );
      for (const item of items) {
        const fr = byFrame.get(item.frameIndex) || { observations: [] };
        observations.push({
          video: name, fps: FPS, frameStart: item.frameIndex,
          result: { observations: Array.isArray(fr.observations) ? fr.observations : [] },
          source: "contact_sheet"
        });
        completed.add(name + "::fps=" + FPS + "::" + item.frameIndex);
      }
      await saveObservations(observations);
    }
    process.stdout.write("\n");
  }

  console.log("[SWORD-TRAIN] All vision observations collected.");
  const merged = await synthesize(observations);

  const output = {
    version: 2,
    kit: "sword",
    source: "video_reference",
    generatedAt: new Date().toISOString(),
    model: MODEL,
    skillCategories: SKILL_SCHEMA,
    skills: merged.skills || []
  };

  await fs.writeFile(SKILLS_FILE, JSON.stringify(output, null, 2));

  console.log("\n[SWORD-TRAIN] COMPLETE");
  console.log("[SWORD-TRAIN] Observations: " + observations.length);
  console.log("[SWORD-TRAIN] Skills: " + output.skills.length);
  console.log("[SWORD-TRAIN] " + SKILLS_FILE);
  console.log("[SWORD-TRAIN] Minecraft server was NOT used.");
}

main().catch(fail);
