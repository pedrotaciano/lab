# Changelog

## [Unreleased]

### Added

- Added the `lab` command: a local web lab over omp, with teams (a folder each), one omp chat per agent (`--mode rpc-ui --no-ui`), the pixel room, the task board, browser voice and a Tern plugin for Carly.
- Added the old lab's prompt box: effort, model picker with search, context and Compactar in one line; attachments by clip, paste and drop; the drawing board; and dictation with local Whisper (`POST /api/transcrever`).
- Added the Memória tab for teams whose folder is an Egregore instance: the team's `memory/` read-only, synced with Egregore's own `bin/agent.sh sync`.
- Visitors through `tailscale serve` with this machine's own tailnet login are the owner, not a member.
- Added laboratórios: separate `lab` servers (own home, omps and machine) listed in `~/.lab/laboratorios.json`, `local` (started detached, outlives the entry lab) or `ssh` (tunnel kept by the entry lab, remote port read from its `servidor.json`). The entry lab serves the same page at `/l/<id>/`, proxies `/l/<id>/api/*` and `/l/<id>/ws`, passes who you are on (`X-Lab-Autor: dono` for its owner), and lists them in `GET /api/laboratorios` and the `{t:"laboratorios"}` frame; `POST /api/laboratorios/:id/tentar` retries one.
- Added the laboratório switcher on top of the left column (on a phone, over Sala and Times): marks, machine, who works and who waits for you in each lab; a lab that is down shows its last teams dimmed, with Tentar de novo.
- The Tern plugin reads every laboratório: `estado()` lists them, the chat functions take an optional `lab`, and the toasts name the lab.
- Added the EC2 laboratório: the lab on `pedro@10.2.69.148` as the `systemctl --user` service `lab` (127.0.0.1:4300, its own bun), reached from the Mac by an SSH tunnel.
