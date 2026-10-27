# Release test — Windows and macOS

Run this on **each** operating system with the **production installer** before moving to the next release stage. Unsigned builds are for testing only and are not the final enterprise release.

## Automated (CI runs this on Windows, macOS and Linux)
`node scripts/packaged-check.mjs "<packaged developer-channel app>"` drives the real packaged app: launch, add TMX and ZIP, scan, language/filter selection, all four outputs, output and log verification, close, reopen, process again (31 checks). It uses a developer-channel package because it needs the debugging port, which production builds refuse by design.

## Manual (needs a person on the machine)
| # | Step | Expected |
|---|---|---|
| 1 | Install the production installer (Windows: per-user, no admin prompt; macOS: drag to Applications) | Installs; no admin rights asked on Windows |
| 2 | Launch from Start menu / Launchpad | Window opens, header shows `vX.Y.Z` and **no** "developer build" label |
| 3 | Press F12, Ctrl/Cmd+Shift+I, F5 | Nothing opens or reloads; no View/DevTools menu |
| 4 | Drag a `.tmx` and a `.zip` onto the window (and try *Add files…*) | Both listed, scan summary shown |
| 5 | Pick Brand, Approval, Source/Target language, All-to-All, a date range | Live count changes as expected |
| 6 | Process to Excel, CSV, Markdown, TMX | Completion screen; *Open Output Folder* opens `Documents/Split TM/TMX Output/<date>/<run>/` with one file |
| 7 | Open the outputs; check language codes (`en_GB`), no inline tags, a `=`/`+`/`-`/`@` segment shows with a leading `'` in CSV | As described |
| 8 | Open `Processing_Log.xlsx` (app-data folder) | One new row per run, skipped records explained |
| 8b | Select **2+ Brands**: the *Multiple Brand Output* panel appears (not with 0 or 1 Brand). Run once with **Single File**, once with **Separate Files** | Single: one file. Separate: one file per Brand in the same run folder, one Run ID, completion screen lists every file with its record count |
| 9 | Quit, reopen, process again | Log keeps old rows and appends |
| 10 | Install a newer build over the old one | "Updated from … to …" banner; outputs and log kept; `Backups/` created |
| 11 | Uninstall | User data and outputs remain |
| 12 | Gatekeeper / SmartScreen | Unsigned builds warn; signed + notarized builds must not |

Record OS version, build number and any platform-specific issue found.
