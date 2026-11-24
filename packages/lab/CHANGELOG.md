# Changelog

## [Unreleased]

### Added

- Added the `lab` command: a local web lab over omp, with teams (a folder each), one omp chat per agent (`--mode rpc-ui --no-ui`), the pixel room, the task board, browser voice and a Tern plugin for Carly.
- Added the old lab's prompt box: effort, model picker with search, context and Compactar in one line; attachments by clip, paste and drop; the drawing board; and dictation with local Whisper (`POST /api/transcrever`).
- Added the Memória tab for teams whose folder is an Egregore instance: the team's `memory/` read-only, synced with Egregore's own `bin/agent.sh sync`.
- Visitors through `tailscale serve` with this machine's own tailnet login are the owner, not a member.
