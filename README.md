# HELLO,

# ZOYA

# 🚀 ZOYA — AI Companion

> A desktop AI companion with a persistent 3D character, conversational intelligence, expressive behavior, voice, lip-sync, and a growing procedural animation system.

## 📌 CURRENT CODE COMMIT — CHECK THIS FIRST

**Latest code commit:** `7df170f29611faba6e63d486a02729d7d43deac2`  
**Exact commit message:** `Restore main ZOYA workspace after companion exit`

**README update commit:** this README synchronization commit follows the code commit above.

> **Important:** Wave development has been dropped. The validated Point and Bow remain intact. The new desktop-companion work is separate from the existing minimized chat widget.

### Current animation validation state
- **Character:** `Carlotta.vrm`
- **Animation architecture:** clean character-space spatial pose-solving system
- **Point:** **working correctly — visually validated by user**
- **Bow:** **working correctly — visually validated**
- **Wave:** **removed — no longer part of the active gesture system or roadmap**
- **Startup Bow:** **implemented — automatically starts once after Carlotta finishes loading in normal ZOYA mode**
- **Desktop companion:** **implemented as a separate Tauri window; companion-exit restoration is now synchronized with the main React workspace**
- **Companion window:** transparent, compact, always-on-top, hidden from the taskbar, positioned near the bottom-right desktop/taskbar area
- **Companion motion:** procedural jump-in → sit → idle, with controlled restore to standing
- **Main window:** hidden while companion mode is active and restored from the companion controls; the normal 3D workspace is remounted after restore
- **Minimized chat widget:** remains separate; Carlotta is not embedded into it
- **Camera / OrbitControls:** normal ZOYA camera behavior remains protected; companion uses separate framing and disables OrbitControls
- **MToon / textures / performance settings:** preserved

### Exact desktop-companion code commits

1. **CODE COMMIT** `3589d6902ac7f396186967419eb035808307d33b` — `Implement Carlotta desktop companion motion`
2. **CODE COMMIT** `085a4cded16bdd0c1648733ed6c43d0e5600bcf6` — `Implement Tauri desktop companion window`
3. **CODE COMMIT** `ba7c30bf534054a44a43426180316beef29ccfd0` — `Add Tauri companion window bridge`
4. **CODE COMMIT** `84441d21ec8a392676e9ba46d650c529cbd5888a` — `Integrate Carlotta companion motion into renderer`
5. **CODE COMMIT** `c38b1f8f9c134ec0a32bdc7a729977c8c2b528ad` — `Add standalone Tauri companion UI`
6. **CODE COMMIT** `338c849c93d8f378e6b8f6b8f98ecd4ab85647` — `Route Tauri companion window to standalone UI`
7. **CODE COMMIT** `15d428bdba25bd7a399430bcb16256f18c4ebad9` — `Launch real Tauri companion from minimize control`
8. **CODE COMMIT** `6b88d20883106f3c18d40d803ad5c9a44414edba` — `Harden companion window URL setup`
9. **CODE COMMIT** `7df170f29611faba6e63d486a02729d7d43deac2` — `Restore main ZOYA workspace after companion exit`

---

## ✨ What ZOYA Is

ZOYA is designed to feel like a real AI companion rather than a static chatbot. The goal is a character that can talk, listen, react, remember, express emotions gradually, move naturally, and eventually perform a large library of procedural and learned animations.

## 🧠 AI / Conversation

- Groq-powered conversational brain
- Context-aware animation intents
- Animation Skill Resolver between the AI and character controllers
- Safe fallback when an animation skill is unavailable
- Local profile / memory persistence
- Profile deletion support
- Clear Chat control
- Designed for user-supplied API configuration rather than shipping the developer's private key

## 🎭 Carlotta Character

- Current production character: **Carlotta.vrm**
- VRM 0.0 character pipeline
- Three.js + `@pixiv/three-vrm`
- Relaxed procedural idle
- Gradual, persistent emotional states
- Facial expressions and phoneme-based lip-sync
- No Mixamo dependency
- No external animation clips required for the procedural gesture system

## 🗣️ Voice

- Text-to-speech integration
- Lip-sync driven from Carlotta's expression system
- Goal: natural, cute, low-latency voice
- Long-term goal: multilingual text and speech

## 🎬 Animation System

ZOYA's animation architecture is designed as:

**Groq → Animation Intent → Skill Resolver → Gesture / Behavior Skill → Pose Solver → Carlotta Controller**

The controller owns bone transforms. AI intents never directly manipulate bones.

### Current Gesture Rebuild

The previous experimental gesture solver has been replaced with a clean foundation built around **character-space pose solving**.

The new system:

- Derives Carlotta's forward/right/up frame from the actual loaded VRM root
- Automatically respects the existing 180° root orientation correction
- Measures real bone directions from the loaded skeleton
- Uses spatial pose targets rather than relying on guessed world-axis Euler signs
- Starts from the actual live pose
- Blends into gestures and recovers smoothly
- Keeps the normal idle controller separate
- Preserves deterministic gesture lifecycle and safe cancellation

Point and Bow established the validated spatial foundation. Wave experimentation has been discontinued and its implementation has been removed.

### Procedural Gesture Roadmap

1. ✅ **Point** — working correctly and visually validated by user
2. ✅ **Bow** — working correctly and visually validated
3. ❌ **Wave** — removed
4. **Greeting**
5. **Goodbye**
6. **Shrug**
7. **Clap**

### Startup Animation

After the Carlotta VRM finishes loading and the character is ready, ZOYA automatically plays the validated **Bow** animation once as her startup greeting in normal mode. After the Bow completes, Carlotta returns to her normal procedural idle.

### Desktop Companion

The real taskbar companion is now implemented at the Tauri desktop layer rather than inside the minimized chat widget.

```text
ZOYA Main Window
      ↓
Minimize / Companion button
      ↓
Tauri creates compact companion window
      ↓
Transparent + always-on-top + skip-taskbar
      ↓
Position near bottom-right/taskbar area
      ↓
Carlotta jump
      ↓
Carlotta sits
      ↓
Companion idle / talking / reacting
      ↓
Restore control
      ↓
Companion closes
      ↓
Main ZOYA window returns
      ↓
Normal 3D workspace remounts
```

The companion has its own renderer framing and does not modify the normal ZOYA camera/OrbitControls configuration. The existing minimized chat widget remains a normal chat UI and does not contain Carlotta.

### Gesture Design Rules

- Character-space spatial targets instead of guessed Euler rotations
- Calibration from the actual loaded skeleton
- Root-aware forward/right/up frame
- Sequential pose solving for articulated limbs
- Smooth start / active / recovery lifecycle
- Snapshot-based blending
- Gesture ownership separated from the normal idle controller
- Missing bones handled safely
- No `AnimationMixer` requirement
- No mesh vertex manipulation
- No skeleton replacement
- No random rapid gesture or mood changes

## 💤 Idle / Behavior

Carlotta's normal procedural idle is a protected foundation.

Other behavior states include:

- Idle
- Listening
- Talking
- Thinking

Gestures are layered on top of the character system rather than replacing the idle foundation.

## 😊 Emotion System

Supported procedural emotions include:

- Calm
- Happy
- Excited
- Sad
- Angry

Emotion changes are intended to be gradual and continuous rather than randomly changing every response.

## 🖥️ Desktop / Performance

- React 19 + TypeScript + Vite
- Express backend
- Tauri 2 desktop target
- Windows packaging support
- Local persistence
- Quality tiers for lower-end hardware
- Carlotta texture-quality controls
- Spring-bone throttling support
- Performance diagnostics for CPU/GPU/render timing
- Dedicated desktop companion window architecture

Performance work is kept separate from the animation architecture so gesture experiments do not silently change rendering behavior.

## 🛣️ Future Plans

### Near term

- Validate the new Tauri companion on the Windows desktop
- Tune companion taskbar offset and visual scale from real testing
- Validate jump → sit transition on Carlotta's actual skeleton
- Add richer companion reactions while preserving the protected idle/gesture layers
- Implement/rebuild **Greeting**
- Implement/rebuild **Goodbye**
- Implement/rebuild **Shrug**
- Implement/rebuild **Clap**

### Mid term

- Larger procedural gesture library
- More expressive reactions
- Better conversational animation timing
- More natural voice/TTS latency
- Stronger persistent memory and personality continuity
- Multilingual speech and text
- Screen sharing
- Voice-controlled computer actions such as opening websites/apps
- **Minecraft gameplay support — allow Carlotta/Zoya to play Minecraft with the user through future computer-control/gameplay capabilities**

### Long term

- Local animation-skill discovery and caching
- Safe animation retargeting for compatible assets
- Skill quality validation before activation
- A growing reusable animation library
- Lightweight in-app browsing experience
- Richer taskbar/desktop companion behavior
- More believable social behavior and environmental awareness
- **Deeper game interaction and gameplay assistance, including Minecraft**

## 🎮 Future Game Interaction

One of ZOYA's longer-term goals is for Carlotta to become an actual interactive companion inside games — not just talk about them.

A future version could be able to:

- **Play Minecraft with the user**
- Understand game-related voice commands
- Perform computer/game actions through controlled interfaces
- React conversationally to what is happening in-game
- Eventually cooperate with the user during gameplay

This is a future capability and is not currently implemented.

## 🔒 Animation Safety Rules

The following are deliberately protected unless a task specifically targets them:

- Carlotta root orientation
- Camera and OrbitControls
- Normal idle controller
- MToon appearance
- Texture-quality system
- Groq/chat integration
- TTS
- Lip-sync
- Performance configuration
- **Wave remains dropped and must not be resurrected**

## 🧪 Current Development Workflow

1. Make one targeted animation/companion change.
2. Commit it with a clear commit message.
3. **Immediately synchronize this README with the exact new code commit SHA and exact commit message.**
4. Run the exact code commit locally.
5. Validate the visible result.
6. Only then move to the next change.

For the companion specifically, GitHub is the primary development workspace and the local PC is used for pulling/running/testing.

## 📂 Core Architecture

```text
ZOYA
├── React / TypeScript UI
├── Groq conversation layer
├── Express API
├── Tauri desktop shell
│   ├── Main ZOYA window
│   └── Separate companion window
└── zoya-ai-companion-MAIN
    └── Carlotta VRM
        ├── Idle controller
        ├── Animation controller
        ├── Gesture controller
        ├── Companion motion controller
        ├── Character-space pose solver
        ├── Expression controller
        └── Lip-sync controller
```

## 🎯 Project Goal

> **Make ZOYA feel like a believable AI companion — not just an AI chat window with a 3D model.**
