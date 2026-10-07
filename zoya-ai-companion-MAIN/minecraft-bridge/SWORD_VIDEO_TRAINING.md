# Sword PvP Video Training

## Requirements
- Node.js 20+
- ffmpeg and ffprobe on PATH
- GROQ_API_KEY
- Your two sword montage videos

The trainer uses Groq's current vision-capable Qwen 3.8 27B model. It samples the videos into still frames, analyzes small consecutive frame groups, then synthesizes a conservative Sword skill library. It does not send video directly and never controls Minecraft during training.

## Windows steps
1. In the bridge directory, create minecraft-training\\videos.
2. Copy both sword montage files into that folder.
3. Open PowerShell in the bridge directory.
4. Set the API key for this terminal: $env:GROQ_API_KEY="YOUR_KEY"
5. Check ffmpeg: ffmpeg -version and ffprobe -version
6. Run: npm run train:sword
7. Results are written to minecraft-training\\sword\\:
   - observations.json
   - sword-skills.json
   - frames\\

Optional environment variables:
- ZOYA_TRAIN_FPS=0.5 (one frame every 2 seconds)
- ZOYA_VISION_MODEL=qwen/qwen3.8-27b

## Server
No Minecraft server and no player are needed for video processing. A server is required only for the later practice/evaluation stage, when Zoya connects and you join as the opponent/training target.

## Safety of the learning pipeline
Montage footage is reference material, not ground-truth game telemetry. The trainer records confidence and evidence and avoids inventing invisible key presses. The generated skills are not automatically promoted into production combat; they must be connected to the deterministic Sword PvP controller and passed through controlled Minecraft drills.
