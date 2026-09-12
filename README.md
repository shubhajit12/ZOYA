# HELLO,

# ZOYA

# 🚀 ZOYA — AI Companion

> A desktop AI companion with a persistent 3D character, conversational intelligence, expressive behavior, voice, lip-sync, and a growing procedural animation system.

## 📌 CURRENT CODE COMMIT — CHECK THIS FIRST

**Latest code commit:** `aa13de718c69c7ddd5063f1e5f955be8230ba784`  
**Exact commit message:** `Fix Carlotta Wave shoulder ownership root cause`

> **Important:** Wave development has now been dropped. The commit above remains the latest code commit; this README update records the new animation direction.

### Current animation validation state
- **Character:** `Carlotta.vrm`
- **Animation architecture:** clean character-space spatial pose-solving system
- **Point:** **working correctly — visually validated by user**
- **Bow:** **working correctly — visually validated**
- **Wave:** **dropped — no longer part of the animation roadmap**
- **Next animation behavior:** after Carlotta finishes loading, she will perform the validated Bow animation once, then return to normal idle
- **Gesture trigger path:** restored and connected to the rebuilt controller
- **Point solver:** uses Carlotta's actual character-forward axis after the existing 180° root correction
- **Hand/wrist handling:** Point no longer uses the problematic fallback hand-axis alignment
- **Other gestures:** not yet implemented/validated on the rebuilt system
- **Idle:** preserved as the normal post-gesture state
- **Camera / OrbitControls:** untouched
- **MToon / textures / performance settings:** untouched

> ⚠️ For gesture testing, make sure you are running the exact latest code commit shown above. The README commit itself is not the code commit.

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

Point and Bow established the validated spatial foundation. Wave experimentation has been discontinued rather than carried forward.

### Procedural Gesture Roadmap

1. ✅ **Point** — working correctly and visually validated by user
2. ✅ **Bow** — working correctly and visually validated
3. ❌ **Wave** — dropped
4. **Greeting**
5. **Goodbye**
6. **Shrug**
7. **Clap**

### Startup Animation

After the Carlotta VRM finishes loading and the character is ready, ZOYA will play the validated **Bow** animation once as her startup greeting. After the Bow completes, Carlotta returns to her normal procedural idle.

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

Performance work is kept separate from the animation architecture so gesture experiments do not silently change rendering behavior.

## 🛣️ Future Plans

### Near term

- Implement/rebuild **Greeting**
- Implement/rebuild **Goodbye**
- Implement/rebuild **Shrug**
- Implement/rebuild **Clap**
- Improve gesture/idle blending
- Expand animation intent vocabulary
- Add better developer diagnostics for animation skills

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
- Minimized/taskbar companion mode with character reactions
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

## 🧪 Current Development Workflow

1. Make one targeted animation change.
2. Commit it with a clear commit message.
3. **Immediately update this README's Current Code Commit section with the exact new code commit SHA and exact commit message.**
4. Run the exact code commit locally.
5. Validate the visible result.
6. Only then move to the next gesture.

This makes it easy to identify exactly which commit introduced a change or regression.

## 📂 Core Architecture

```text
ZOYA
├── React / TypeScript UI
├── Groq conversation layer
├── Express API
├── Tauri desktop shell
└── ZOYA-MAIN
    └── Carlotta VRM
        ├── Idle controller
        ├── Animation controller
        ├── Gesture controller
        ├── Character-space pose solver
        ├── Expression controller
        └── Lip-sync controller
```

## 🎯 Project Goal

> **Make ZOYA feel like a believable AI companion — not just an AI chat window with a 3D model.**
