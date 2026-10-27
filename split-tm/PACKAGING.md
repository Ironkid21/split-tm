# Packaging Split TM

Single source of truth for the version is `package.json` (semantic versioning); the app, the TMX header and the processing log all read it.

## What ships
Only `dist/` (bundled main process, preload and renderer) and `package.json` go into `app.asar`. All libraries are bundled at build time, so end users need no Python, Node, Java or terminal. Source maps are excluded. Inputs are streamed, so nothing is written to a temp folder.

## Local builds
| Command | Result |
|---|---|
| `npm run verify` | typecheck + tests |
| `npm run pack` | unpacked app for the current OS (`release/`) |
| `npm run dist:win` | NSIS installer + zip (run on Windows) |
| `npm run dist:mac` | DMG + zip, x64 and arm64 (run on macOS) |

Installers are built on their own OS, so use the **Release** GitHub workflow (`.github/workflows/release.yml`, on `vX.Y.Z` tags or manually).

## Windows
- Per-user install, `asInvoker`, no admin rights, no services; the zip needs no install at all.
- Uninstall does not delete user data (`deleteAppDataOnUninstall: false`).
- Signing: set `CSC_LINK` (base64 or path to the .pfx) and `CSC_KEY_PASSWORD`. Unsigned builds work but trigger SmartScreen.

## macOS
- Hardened runtime with minimal entitlements (`build/entitlements.mac.plist`).
- Signing: `CSC_LINK`/`CSC_KEY_PASSWORD` with a *Developer ID Application* certificate.
- Notarization: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Without them the build is not notarized.
- Unsigned test build: `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac`.

## Hardening applied to the Electron binary (fuses)
`runAsNode` off, `NODE_OPTIONS` off, inspector CLI args off, cookie encryption on, load app only from asar, asar integrity validation on.

## Where user data lives (never inside the install folder)
| Data | Windows | macOS |
|---|---|---|
| Logs, config, temp, browser profile | `%APPDATA%\Split TM\` | `~/Library/Application Support/Split TM/` |
| Generated output (default, configurable) | `Documents\Split TM\TMX Output\` | `~/Documents/Split TM/TMX Output/` |

## Upgrades
Installing a new version only replaces the application files. User data is never inside the install folder, and the Windows uninstaller keeps it.

On every start, `runStartupMigration` (src/engine/upgrade.ts) compares the version recorded in `state.json` with the running version:

| Situation | Behaviour |
|---|---|
| First install | Writes `state.json` only. |
| Same version | Nothing. |
| Older data → newer app | Copies config, state and log to `Backups/<from>_to_<to>_<time>/`, then adds missing config keys and missing log columns. Old rows, unknown columns and unknown settings are kept. Output folders are not touched and nothing is reprocessed. |
| Data from a newer app (downgrade) | Nothing is modified; a warning is shown. |
| Corrupt or locked file | App still starts, a warning is shown, nothing is deleted, the version is not advanced so the upgrade retries on the next start. |

Only abandoned `Temp/run-*` folders older than 24 hours are cleaned up. To change the log layout in a future release, add columns to `LOG_COLUMNS` (additive) or add an entry to `MIGRATIONS` in `src/engine/config.ts` for settings, and bump `version` in `package.json`.

## Build channels (Developer Tools)
| Command | Channel | Developer Tools |
|---|---|---|
| `npm run dev` | not packaged | enabled |
| `npm run pack:dev` / `build:dev` | developer | enabled (header shows "developer build") |
| `npm run pack` / `dist:win` / `dist:mac` | production (default) | **disabled**; the app also refuses remote-debugging switches |

Only ship production builds. `scripts/build-main.mjs --channel developer|production` bakes the channel into the app.

## macOS build status
`electron-builder --mac dir` (unsigned) was run on Linux to validate the configuration: the bundle has the right identifier and version, a generated `icon.icns`, hardened Electron fuses and only `dist/` + `package.json` inside `app.asar`. It has **not** been run on macOS, signed or notarized; that needs a Mac and the Apple credentials (see above). Use `RELEASE_TEST.md` on a Mac before release.

## Icons
Everything icon-related lives in `build/`. electron-builder uses `build/icon.png` (1024×1024) and generates `.ico` (Windows exe, installer, taskbar) and `.icns` (macOS app, DMG, Dock) from it. To use hand-made files, drop `build/icon.ico` and `build/icon.icns` next to it. No code changes are needed; the current image is a placeholder for the final branding stage.

## Testing the packaged apps
CI (`.github/workflows/release.yml`) runs `scripts/packaged-check.mjs` against a developer-channel package on Windows, macOS and Linux before building installers. The manual install/launch/uninstall steps are in [RELEASE_TEST.md](RELEASE_TEST.md).
