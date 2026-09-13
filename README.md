# HELLO,

# ZOYA

# 🚀 ZOYA — AI Companion

> A desktop AI companion with a persistent 3D character, conversational intelligence, expressive behavior, voice, lip-sync, and a growing procedural animation system.

## 📌 CURRENT CODE COMMIT — CHECK THIS FIRST

**Latest code commit:** `ee08979496af0311501b9c06bb9100cf1da3dffe`  
**Exact commit message:** `Fix Windows icon generation before Tauri build`

**Feature code commit:** `e27316eba62f41a314ed6b68c7656bd0cefe9865`  
**Exact commit message:** `Move Carlotta further down in desktop companion`

**Companion integration commit:** `a679ce5922b0a47e1d7d0eefccd6beb21f1aea39`  
**Exact commit message:** `Fix companion grounding build integration`

**Previous feature commit:** `dcca4dfdd0ffb7419ca1cf40ac5d8c7c730de677`  
**Exact commit message:** `Fix actual Carlotta companion model grounding`

**README update commit:** this README synchronization commit follows the code commit above.

> **Important:** Wave development has been dropped. The validated Point and Bow remain intact. The new desktop-companion work is separate from the existing minimized chat widget.

### Current animation validation state
- **Character:** `Carlotta.vrm`
- **Point:** **working correctly — visually validated by user**
- **Bow:** **working correctly — visually validated**
- **Wave:** **removed — no longer part of the active gesture system or roadmap**
- **Startup Bow:** **normal ZOYA mode only**; the desktop companion cancels it so the companion arrival animation is not mixed with the startup greeting
- **Desktop companion:** **implemented as a separate Tauri window**
- **Companion startup:** waits for Carlotta VRM to finish loading, then explicitly starts the companion arrival motion
- **Native minimize:** the Windows title-bar minimize action is routed into the same desktop-companion flow instead of simply minimizing the main ZOYA window
- **Native minimize implementation:** uses Tauri's `Manager` trait in the setup polling scope so `get_webview_window` and related window APIs compile correctly
- **Companion window:** transparent, compact, always-on-top, hidden from the taskbar, positioned against the monitor work area with the native Windows `Shell_TrayWnd` rectangle used to determine the taskbar edge; this avoids mixing DPI-virtualized taskbar coordinates directly with Tauri logical coordinates
- **Companion placement diagnostics:** native logs record the logical target position, scale factor, actual physical outer position, actual physical inner size, and detected taskbar edge
- **Companion motion:** procedural jump-in → sit → idle, with controlled restore to standing
- **Seated behavior:** lower-body seated pose now includes a controlled alternating leg swing instead of a frozen pose
- **Companion model grounding:** Carlotta's actual 3D scene is lowered in world space by the renderer only while companion mode is active; the renderer surface, native window, and companion controls are not shifted
- **Current grounding adjustment:** the companion-only Carlotta Y offset is now `-1.45` world units
- **Windows build icon repair:** the workflow regenerates `src-tauri/icons/icon.ico` as a valid multi-size ICO from the existing PNG asset before invoking the Tauri Windows build
- **Main window restore:** companion exit closes the companion, shows the main window, reloads the main React workspace, and focuses it so the normal 3D workspace is recreated instead of remaining on the minimized chat widget
- **Minimized chat widget:** remains separate; Carlotta is not embedded into it
- **Camera / OrbitControls:** normal ZOYA camera behavior remains protected; companion uses separate framing and disables OrbitControls
- **MToon / textures / performance settings:** preserved

### Latest companion fixes

1. **CODE COMMIT** `242dc6155f6b10cae14e2012f09873fcd3e3189b` — `Make companion motion start after Carlotta loads`
2. **CODE COMMIT** `1c23e33028c73b39e6231e3226b435d63be521af` — `Reload main window after companion restore`
3. **CODE COMMIT** `f4e6222085087d66f1843761bb6568ba7eb85ef1` — `Route native window minimize into desktop companion`
4. **CODE COMMIT** `c9490114d375f21315970eb11e13c4ed9463e019` — `Fix Tauri Manager trait import for native minimize`
5. **CODE COMMIT** `0fe1d89886a74af6f2708bd41ea7f983750d57e4` — `Remove unsupported Tauri redirection bitmap API`
6. **CODE COMMIT** `fae1efa0ff75d9293f687393f14f1f39b0f3885d` — `Fix Carlotta companion sit pose and leg swing`
7. **CODE COMMIT** `821434fb9e7ef1e32f6685081561f7862017eb8a` — `Lower companion window to taskbar`
8. **CODE COMMIT** `adc5254d099497c6f9b84a072f2ca0d2c922a3ce` — `Position companion against Windows taskbar work area`
9. **CODE COMMIT** `02fef3d55b8f6621a16ea274e3a5d8236cca915d` — `Use Windows taskbar coordinates for companion positioning`
10. **CODE COMMIT** `75bd192ba8bd89630a0291bcaef673fbd7e9e07b` — `Fix companion DPI-safe taskbar anchoring`
11. **CODE COMMIT** `29a6d67fbdec12e88aa7d59e17828bedc5908e5e` — `Lower Carlotta inside companion window`
12. **CODE COMMIT** `f16cb4added6a5c8d5fb04054c1a6eb456197405` — `Tune Carlotta companion grounding from screenshot`
13. **CODE COMMIT** `13375e7bd81f0c347a676602b2d684394e5939dc` — `Lower Carlotta model inside companion scene`
14. **CODE COMMIT** `dcca4dfdd0ffb7419ca1cf40ac5d8c7c730de677` — `Fix actual Carlotta companion model grounding`
15. **CODE COMMIT** `e27316eba62f41a314ed6b68c7656bd0cefe9865` — `Move Carlotta further down in desktop companion`
16. **CODE COMMIT** `a679ce5922b0a47e1d7d0eefccd6beb21f1aea39` — `Fix companion grounding build integration`
17. **CODE COMMIT** `cfc927e55fdd4e0cb73a07e732235ac2c6a82b78` — `Remove temporary companion grounding file`
18. **CODE COMMIT** `ee08979496af0311501b9c06bb9100cf1da3dffe` — `Fix Windows icon generation before Tauri build`

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
- Long-term goal: multilingual speech and text

## 🎬 Animation System

ZOYA's animation architecture is designed as:

**Groq → Animation Intent → Skill Resolver → Gesture / Behavior Skill → Pose Solver → Carlotta Controller**

The controller owns bone transforms. AI intents never directly manipulate bones.

### Current Gesture Rebuild

The gesture system uses a clean character-space foundation:

- Derives Carlotta's forward/right/up frame from the actual loaded VRM root
- Respects the existing 180° root orientation correction
- Measures real bone directions from the loaded skeleton
- Uses spatial pose targets rather than guessed world-axis Euler signs
- Starts from the actual live pose
- Blends into gestures and recovers smoothly
- Keeps normal idle behavior separate
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

After Carlotta finishes loading in normal ZOYA mode, the validated **Bow** animation plays once as her startup greeting. The separate desktop companion intentionally cancels that startup Bow and uses its own arrival motion instead.

### Desktop Companion

The real taskbar companion is implemented at the Tauri desktop layer rather than inside the minimized chat widget.

```text
ZOYA Main Window
      ↓
Native Minimize / Companion button
      ↓
Tauri detects the main window minimize request
      ↓
Main window is restored internally and then hidden
      ↓
Tauri creates compact companion window
      ↓
Transparent + always-on-top + skip-taskbar
      ↓
Read Windows Shell_TrayWnd taskbar rectangle
      ↓
Use Tauri work area as the DPI-safe coordinate anchor
      ↓
Place companion against the real taskbar boundary
      ↓
Wait for Carlotta VRM
      ↓
Carlotta jump
      ↓
Carlotta sits
      ↓
Legs swing naturally while seated
      ↓
Lower the actual Carlotta 3D model inside the companion scene
      ↓
Companion idle / talking / reacting
      ↓
Restore control
      ↓
Companion closes
      ↓
Main ZOYA window reloads
      ↓
Normal 3D workspace returns
```

The companion has its own renderer framing and does not modify the normal ZOYA camera/OrbitControls configuration. The existing minimized chat widget remains a normal chat UI and does not contain Carlotta.

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

- Validate the Tauri companion on the Windows desktop
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
