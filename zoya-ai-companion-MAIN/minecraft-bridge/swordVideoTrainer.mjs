#!/usr/bin/env node
/**
 * ZOYA Sword PvP Video Trainer
 * Local video -> sampled frames -> Groq vision observations -> structured Sword skills.
 * It never connects to Minecraft and never controls the bot.
 *
 * Rate-limit design:
 * - Qwen 3.8 27B charges 2048 input tokens per image.
 * - Free/on-demand organizations may have a much smaller ITPM than the
 *   published model ceiling, so vision requests are one image at a time.
 * - Groq rate-limit headers are used to wait before the next request.
 * - Observations are persisted after every successful frame so a 429 or
 *   interrupted run can resume instead of losing prior work.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = path.resolve(process.env.ZOYA_PVP_TRAINING_DIR || "./minecraft-training");
const VIDEO_DIR = path.resolve(process.argv[2] || path.join(ROOT, "videos"));
const OUT_DIR = path.join(ROOT, "sword");
const FRAMES_DIR = path.join(OUT_DIR, "frames");
const OBS_FILE = path.join(OUT_DIR, "observations.json");
const SKILLS_FILE = path.join(OUT_DIR, "sword-skills.json");
const MODEL = process.env.ZOYA_VISION_MODEL || "qwen/qwen3.8-27b";
const API_KEY = process.env.GROQ_API_KEY;
const FPS = Math.max(0.1, Number(process.env.ZOYA_TRAIN_FPS || 0.5));
const MAX_BYTES = 19 * 1024 * 1024;
const VISION_INPUT_ESTIMATE = 2300;
const RETRIES = 5;
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
  await fs.mkdir(dir, { recursive: true });
  const duration = await durationSeconds(video);
  const pattern = path.join(dir, "frame-%06d.jpg");

  // Keep the original default sampling density, but make frames modest in size.
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
    const retryMs = retryHeader || Math.max(2000, resetAtMs - Date.now() + 750);
    console.log(
      "\n[SWORD-TRAIN] Groq 429; retrying in " +
      Math.ceil(retryMs / 1000) + "s (" + attempt + "/" + RETRIES + ")..."
    );
    await sleep(retryMs);
    remainingInputTokens = null;
    resetAtMs = 0;
  }

  throw new Error("Groq request failed after retries.");
}

async function vision(file, videoName, frameIndex) {
  const content = [{
    type: "text",
    text:
      "Analyze this single Minecraft Java Sword PvP montage frame. " +
      "Only report reusable combat behavior that is visually supported. " +
      "Do not invent key presses or hidden game state. Return JSON: " +
      "{observations:[{skill,confidence,evidence,likely_goal,timing_notes}]}. " +
      "skill must be one of: " + SKILL_SCHEMA.join(", ") + ". " +
      "Prefer concise evidence. Video=" + videoName + ", frame=" + frameIndex
  }, {
    type: "image_url",
    image_url: { url: await imageDataUrl(file) }
  }];

  return groqJson([{ role: "user", content }], 700);
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
  return String(item.video) + "::" + String(item.frameStart);
}

async function synthesize(observations) {
  // Keep each synthesis input small enough for low ITPM organizations.
  const compact = observations.map(o => ({
    video: o.video,
    frameStart: o.frameStart,
    observations: o.result?.observations || []
  }));

  const chunks = [];
  const maxChars = 12000;
  let current = [];

  for (const item of compact) {
    const candidate = JSON.stringify([...current, item]);
    if (current.length && candidate.length > maxChars) {
      chunks.push(current);
      current = [item];
    } else {
      current.push(item);
    }
  }
  if (current.length) chunks.push(current);

  const summaries = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(
      "[SWORD-TRAIN] synthesizing observation chunk " +
      (i + 1) + "/" + chunks.length
    );
    const result = await groqJson([{
      role: "user",
      content:
        "Summarize these visual Sword PvP observations into reusable, conservative skills. " +
        "Merge duplicates. Do not invent unsupported mechanics. Return JSON: " +
        "{skills:[{skill,description,when_to_use,avoid_when,confidence,evidence}]}. " +
        "Allowed categories: " + SKILL_SCHEMA.join(", ") + "\n" +
        JSON.stringify(chunks[i])
    }], 1000);
    summaries.push(result.skills || []);
  }

  const mergedInput = summaries.flat();
  if (!mergedInput.length) return { skills: [] };

  return groqJson([{
    role: "user",
    content:
      "Build the final conservative Sword PvP skill library from these summaries. " +
      "Merge duplicates and preserve only skills supported by visual evidence. " +
      "Return JSON: {skills:[{id,name,skill,description,when_to_use,avoid_when,confidence,evidence}]}. " +
      "Allowed categories: " + SKILL_SCHEMA.join(", ") + "\n" +
      JSON.stringify(mergedInput)
  }], 1600);
}

async function main() {
  console.log("=== ZOYA Sword PvP Video Trainer ===");
  if (!API_KEY) throw new Error("GROQ_API_KEY is not set.");

  await requireFfmpeg();
  await fs.mkdir(FRAMES_DIR, { recursive: true });
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

    for (let i = 0; i < sampled.files.length; i++) {
      const key = name + "::" + i;
      if (completed.has(key)) {
        continue;
      }

      process.stdout.write(
        "  analyzing frame " + (i + 1) + "/" + sampled.files.length + "\r"
      );

      const result = await vision(sampled.files[i], name, i);
      observations.push({ video: name, frameStart: i, result });
      completed.add(key);

      // Resume-safe checkpoint after every successful API call.
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
