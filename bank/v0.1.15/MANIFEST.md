# Transient Tools v0.1.15 — Live-Proven Bank

Date: 2026-08-16
Repository: Animeleague/openclaw-plugin-transient-tools
Pinned OpenClaw: 2026.7.1

This bank preserves the exact v0.1.15 source archive and installable TGZ used for the native-context work.

## Exact artifacts

- `openclaw-plugin-transient-tools-0.1.15-source.zip`
  - SHA256: `5bfdc4860f2d3c95dbe361f9f5b9b9082a59302b33d6d724cec35d0f3b55801b`
- `openclaw-plugin-transient-tools-0.1.15.tgz`
  - SHA256: `ab6c2d96d6a4bca6ab9c1b853cf730d7e2a3ac5535ead1a219ae6093701fc873`

## Behaviour

- Installed/enabled live as v0.1.15.
- Keeps the live-proven transient tool-context design.
- No persistent dirty-model/session state.
- No `dirtyModels`, `markDirty`, `consumeDirty`, or `isDirty` policy.
- Source candidate regression suite: 36/36 passed.

Do not replace this bank with the rejected v0.1.14 dirty-session design.
