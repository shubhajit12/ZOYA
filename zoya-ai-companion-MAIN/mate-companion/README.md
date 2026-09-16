# ZOYA Mate Companion — Phase 1

This directory is the integration boundary for the Mate Engine-based desktop companion.

## Architecture

ZOYA (Tauri/React) and the Mate-based companion are separate runtimes. Only one is intended to own the Carlotta companion at a time.

- **ZOYA runtime:** normal/maximized application.
- **Mate companion runtime:** minimized/desktop companion.
- ZOYA can launch the companion and request it to close.
- The companion can request ZOYA to restore/maximize.

## Phase 1 scope

- Establish a dedicated Mate companion integration boundary.
- Keep the existing Tauri companion implementation untouched.
- Define the runtime handoff contract before integrating Carlotta/assets.
- Preserve the Mate source attribution and permission record separately from application logic.

## Source foundation

The companion is based on Mate Engine. The upstream source is:

`https://github.com/shinyflvre/Mate-Engine`

The ZOYA project has received permission from the Mate Engine author to make the ZOYA project private. Keep the original license/permission record with the project when importing or modifying Mate source.

## Next phase

Phase 2 will bring the required Mate Unity runtime/source into this boundary and adapt its desktop interaction layer for ZOYA/Carlotta.
