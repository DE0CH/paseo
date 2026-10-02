# DE0CH build

Deyao's own build of the Paseo iOS app (`APP_VARIANT=de0ch`, bundle `dev.de0ch.paseo`, TestFlight on
team S64YL394S3). Upstream code stays as it is apart from these hooks, so the fork rebases cleanly:

- `packages/app/src/jarvis/`: pairs the install with Jarvis once (`/api/devices/pair?app=paseo` →
  `paseo-de0ch://paired`), lists OpenCode sessions (`/api/remotes?harness=opencode`) and imports each
  started one as a host named after its title. It removes hosts of destroyed sessions and can start
  paused ones. Settings → Jarvis.
- Small hooks into upstream files: the `de0ch` variant in `app.config.js`, a settings section,
  a welcome action, `<JarvisBoot />` in `_layout.tsx`, and `HostRuntimeStore.importTrustedConnectionLink`.
- `.github/workflows/de0ch-ios.yml` + `de0ch/ios/`: simulator build and Maestro check against the live
  Jarvis, then archive, cloud-sign (App Store Connect API key) and upload to TestFlight.

Runbook: `.claude/skills/paseo-ios/SKILL.md` in DE0CH/claude-env.
