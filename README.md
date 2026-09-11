# ZOYA

# 🚀 ZOYA — AI Companion

> A desktop AI companion with a persistent 3D character, conversational intelligence, expressive behavior, voice, lip-sync, and a growing procedural animation system.

## 📌 CURRENT COMMIT — CHECK THIS FIRST

**Commit:** `cc86b1437b6dc6727c19fffb4655068da0e840dd`  
**Commit message:** `Fix Carlotta spatial gesture pose solving`

### Current animation validation state
- **Character:** `Carlotta.vrm`
- **Animation architecture:** spatial pose-solving system
- **Currently validating:** **Point** gesture
- **Bow:** planned next after Point is proven
- **Idle:** preserved and intentionally untouched
- **Camera / OrbitControls:** untouched
- **MToon / textures / performance settings:** untouched

> ⚠️ For testing, make sure you are running the commit shown above. Do not accidentally test an older gesture commit.

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

### Procedural Gesture Roadmap

1. 🔧 **Point** — current diagnostic gesture; spatial target solving
2. ⏭️ **Bow** — spatial torso/forward movement
3. **Wave**
4. **Greeting**
5. **Goodbye**
6. **Shrug**
7. **Clap**

The system is intentionally being validated one gesture at a time. This avoids repeating the previous backwards-direction problems caused by hard-coded Euler-angle assumptions.

### Gesture Design Rules

- Spatial targets instead of guessed Euler rotations
- Rest-pose calibration from the actual loaded skeleton
- World-space target solving
- Smooth start / active / recovery lifecycle
- Snapshot-based blending
- Gesture ownership separated from the normal idle controller
- Missing bones are handled safely
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

- Prove spatial **Point** gesture
- Implement spatial **Bow**
- Rebuild remaining gestures on the same pose solver
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

### Long term

- Local animation-skill discovery and caching
- Safe animation retargeting for compatible assets
- Skill quality validation before activation
- A growing reusable animation library
- Lightweight in-app browsing experience
- Minimized/taskbar companion mode with character reactions
- More believable social behavior and environmental awareness

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
3. Run the exact commit locally.
4. Validate the visible result.
5. Only then move to the next gesture.

This makes it easy to identify exactly which commit introduced a change or regression.

## 📂 Core Architecture

```text
ZOYA
├── React / TypeScript UI
├── Groq conversation layer
├── Express API
├── Tauri desktop shell
└── Carlotta VRM
    ├── Idle controller
    ├── Animation controller
    ├── Gesture controller
    ├── Spatial pose solver
    ├── Expression controller
    └── Lip-sync controller
```

## 🎯 Project Goal

> **Make ZOYA feel like a believable AI companion — not just an AI chat window with a 3D model.**
