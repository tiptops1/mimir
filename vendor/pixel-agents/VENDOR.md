# Vendored: pixel-agents

- **Source:** https://github.com/pixel-agents-hq/pixel-agents
- **Pinned commit:** `cd0343b4ea7c3acf231db6cd07d43a59e3d69cf3` (v1.3.0, vendored 2026-07-19)
- **License:** MIT (see `LICENSE`)
- **Used by:** the C5 "Le Bureau" easter egg (`/bureau`). `npm run bureau:build` builds
  `webview-ui/` and freezes the server handshake into `public/bureau/` — see
  `scripts/bureau-build.ts` and `docs/mimir/decisions.md`.

**Do not edit files in this tree.** Treat it as a dependency: to change behavior, change the
glue in the main repo (shim, boot payload, translator). To update, re-clone at a newer commit,
update the SHA here, and re-run `npm run bureau:build`.

**Custom sprite art goes here** (this is the by-hand part): drop character/furniture PNGs +
`manifest.json` under `webview-ui/public/assets/` (see `docs/external-assets.md` in this tree
for the manifest format), then re-run `npm run bureau:build`.
