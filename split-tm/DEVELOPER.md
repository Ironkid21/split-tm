# Split TM — Developer Manual

Split TM is an offline desktop app (Electron + React + TypeScript) that scans TMX files and ZIPs of TMX, lets the user filter by Brand / Project / Approval / Customer / date and choose source and target languages, and exports the selection as TMX, Excel, CSV or Markdown: **one file**, or, when several Brands are selected and the user chooses *Separate Files*, **one file per Brand** (always one run, one Run ID, one folder). Nothing leaves the machine.

- Packaging, signing, upgrades: [PACKAGING.md](PACKAGING.md). Release testing on Windows/macOS: [RELEASE_TEST.md](RELEASE_TEST.md).
- The reference sample (`Hogarth_JLR-en_GB-it_IT-2026-10-10.zip`) is for testing only. **No customer, project, brand, language, status or date value may be hard-coded in app code.** Everything is discovered from the input.

## 1. Quick start

Requirements: Node.js 22+ and npm. No Python or Java (end users need nothing installed either).

```bash
npm ci
npm run dev        # builds the main process, starts Vite, opens Split TM with hot reload (Developer Tools enabled)
```

| Command | What it does |
|---|---|
| `npm run dev` | Development window (renderer hot reload; restart to pick up main-process changes) |
| `npm run verify` | Typecheck + all tests. Run before every commit |
| `npm test` / `npm run typecheck` | Vitest only / `tsc --noEmit` over `src`, `scripts`, `tests` |
| `npm run build` | **Production** build into `dist/` (Developer Tools disabled) |
| `npm run build:dev` | Same, built for the **developer** channel (Developer Tools enabled) |
| `npm start` | Run the built app |
| `npm run cli -- …` | Headless processing, large-file generator, output validation (section 8) |
| `npm run smoke -- <sample.zip>` | Drives the UI against the reference sample, saves screenshots |
| `npm run pack` / `pack:dev` | Unpacked production / developer-channel app (`release/`, `release-dev/`) |
| `npm run check:packaged -- "<app>"` | End-to-end check of a packaged developer-channel app (section 8) |
| `npm run dist:win` / `dist:mac` | Installers (see PACKAGING.md) |

## 2. Repository layout

```
src/engine/      Pure Node logic, no Electron imports; everything is testable headless
  tmxParser.ts     Streaming parser (saxes) -> TranslationUnit; UTF-8 / UTF-16
  zipStream.ts     Streams .tmx entries straight out of a ZIP (yauzl); nothing is extracted to disk
  dataset.ts       Dataset = compact index + re-readable sources; matchesFilter(); facets()/scan()
  languages.ts     Source/target selection: planSelection(), trimUnit(), applyLanguages()
  exporters.ts     Row/escaping helpers and streaming sinks for CSV, Markdown, Excel, TMX
  csvSafe.ts       CSV formula-injection protection + RFC 4180 quoting
  processor.ts     scanInputs(), processRun(), output naming, run result
  processingLog.ts Central Processing_Log.xlsx (append + migrate)
  upgrade.ts config.ts paths.ts runId.ts semver.ts tmxDate.ts version.ts model.ts index.ts
src/main/        Electron main process: window, IPC, security (main.ts, preload.ts, security.ts, smoke.ts)
src/renderer/    React UI (App.tsx, styles.css, index.html with CSP)
src/shared/      Shared types/constants (api.ts, constants.ts, lang.ts)
scripts/         build-main.mjs, dev.mjs, dev-cli.ts, smoke.mjs, packaged-check.mjs
tests/           engine, run, upgrade, languages, csvSafe, security, streaming tests + fixtures
build/           Icon and macOS entitlements
```

Rule of thumb: logic in `src/engine`, thin `src/main`, no Node access in the renderer.

## 3. Architecture

Two passes over the input, so memory does not depend on file size:

```
Pass 1  SCAN    TMX / ZIP entry --stream--> parser --> compact index (no segment text)
                                                          │ scan()/facets() fill the UI
                                       filters + language selection (planSelection)
                                                          │ mask[] of selected units + output columns
Pass 2  EXPORT  TMX / ZIP entry --stream--> parser --> selected unit --> sink --> ONE output file
                                                                  (CSV | Markdown | Excel | TMX)
```

- The **index** holds one small object per unit (brands, project, statuses, dates, source/target languages, TUID fingerprint). Strings and arrays are shared, so 1,000,000 units fit in a few hundred MB.
- Pass 2 re-reads the inputs in the same order and writes each selected unit immediately. A TUID fingerprint check stops the run with a clear message if a file changed after scanning.
- **No input is copied to disk.** TMX files are read in place; ZIP entries are streamed from the archive, so there is no temp copy to clean up. (A `Temp/` folder from older versions is cleaned of stale `run-*` folders at startup.)
- **One filter, one selection.** Every output format and the live count use `matchesFilter` + `planSelection`; exporters never filter.

Key rules (from the product spec):
1. Everything is discovered from the input; filter lists come from `scan()` / `facets()`.
2. **Brand is a list.** *Units*, *unique brands* and *brand assignments* are different numbers and the UI shows all three. A unit is exported once even if several selected brands match.
3. Customer is optional and never auto-selected.
4. Local only; no network calls.
5. No valid translation data is silently lost: anything skipped or not exported is counted, shown and logged.

### TMX field mapping (`tmxParser.ts`)

| TMX | Model field | Notes |
|---|---|---|
| header `<prop type="user-defined">CUSTOMER: X</prop>` | `customer` | File-level; copied onto every unit |
| header `srclang` | source language | A unit's source is the TUV whose `xml:lang` equals it (`*all*` falls back to the first TUV) |
| `<tu tuid>` | `tuid` | |
| `<prop type="JLR">` (repeatable) | `brands[]` | Business rule: JLR values are Brands, deduplicated per unit. Prop name = `ParseOptions.brandPropType` (default `JLR`) |
| `<prop type="x-Project">` | `projects[]` | |
| `<prop type="x-xtm-status">` / `Status` | `approvalStatus` / `translationStatus` | Different fields |
| `creationdate` / `changedate` | `creationDate` / `modifiedDate` | UTC; invalid becomes `null`, never an exception |
| other `<tu>` attributes, all `<prop>` | `attrs`, `metadata` | Preserved for TMX output |
| `<seg>` | `source.text` / `targets[].text` | Kept as XML so inline tags survive |

A unit with **no source-language TUV** is not exported; it is collected in `Dataset.skipped` with its TUID, file and reason (`Missing source-language entry (en-GB)`), shown as a warning in the UI and written to the log.

### Filter semantics (`matchesFilter`)
Empty/absent list = no filter. OR inside a dimension, AND across. The date filter always uses the **creation date** (inclusive bounds); a unit with no creation date is excluded once a date bound is set. Units with no Brand use the `NO_BRAND` sentinel `"(No Brand)"`.

### Language selection (`languages.ts`)
One consolidated result: **one row per translation unit, one column per language.**
- `sourceLanguages` (empty = all sources), `targetLanguages` (empty = all targets), `allToAll` (explicit All-to-All; equivalent to leaving both empty, shown as a mode in UI and log).
- A unit is exported when its source language is selected **and** it has at least one selected target language. Units with no selected target are counted as *not exported* (reported, not silent). Missing targets stay blank, never shifted.
- Columns: source languages actually used (sorted) first, then the other languages (sorted): deterministic across runs.
- Multiple source languages across files are fully supported; units are never dropped just because sources differ.
- UI labels come from `src/shared/lang.ts` (`Intl.DisplayNames`): `English — en_GB`.

### Output rules
- **TMX:** native structure, original props/attributes and inline tags preserved; header attributes copied from the first input; `creationtool="Split TM"` + app version; `srclang` is the source language, or `*all*` when units have different sources; only the selected languages are kept.
- **Excel / CSV / Markdown:** text only. Header = language codes with `_` (`en_GB`). Inline code tags (`bpt ept ph it ut x bx ex`) are removed with their content, wrapper tags (`hi`, `sub`) keep their text, entities decoded (`plain()`); rows whose source is empty afterwards are skipped and counted.
- **CSV safety (`csvSafe.ts`):** content is data, never a formula. A field starting with `=`, `+`, `-`, `@` (also after whitespace, or a leading TAB/CR) gets one leading apostrophe; the full original text stays visible and is recovered by removing that first character. Commas, quotes, line breaks and Unicode are quoted/passed through. UTF-8 with BOM, CRLF. Applies to every field. **Trade-off:** legitimate text such as `-5 °C` or `+49 …` also gets the apostrophe.
- **Excel:** values are stored as plain strings (no formula elements; tested). One workbook, bold frozen header, wrapped cells; after 1,000,000 rows it continues on sheets `TM 2`, `TM 3`, … (Excel's limit is 1,048,576 per sheet). A lone CR inside a cell becomes LF (XML normalisation).
- **Markdown:** pipes escaped, compact table.
- **File names:** brands joined with ` + ` (up to two, else `N Brands`, none → `All Brands`), `_<approval>` if exactly one approval status is selected, illegal characters replaced, max 80 chars.

### Multiple Brand output mode
When **more than one Brand** is selected the user chooses an *Output Mode* (the choice is not shown for zero or one Brand):

| Mode | Result |
|---|---|
| **Single File** (default) | One file with the union of all selected Brands. A unit that carries several selected Brands appears **once**. |
| **Separate Files** | One file per selected Brand (`Range Rover.xlsx`, `Jaguar.xlsx`, …), all in the same run folder under the same Run ID. |

How it works (`processor.ts`): a run builds a list of *jobs*. Single mode has one job (the whole selection, same file name as before). Separate mode has one job per Brand, each with its own `planSelection` (same filters and language rules, restricted to that Brand), its own columns and its own sink. The inputs are streamed **once** and every selected unit is routed to every job it belongs to, so exporters, filters and language logic are exactly the existing ones.

Rules worth knowing:
- A unit with several selected Brands is written to **each** of those Brand files, so the sum of file records can exceed *Records selected* (unique units). The completion screen and the log show both.
- Each Brand file is its own consolidated dataset: its language columns follow the languages present in that Brand's units, blanks stay blank, and all existing rules (inline tags, CSV safety, TMX fidelity) apply per file.
- `(No Brand)` is a selectable Brand and gets its own file. A Brand with no matching records after the other filters gets **no file** and a warning (the run fails only if nothing at all matches).
- File names come from the Brand (underscores become spaces, `_<approval>` appended when exactly one approval status is selected); a collision gets ` (2)`, ` (3)`, …
- `outputMode: 'separate'` with fewer than two Brands is ignored (single file).
- A run that fails before finishing removes its partly written files and the empty run folder, and is logged as failed; finished outputs are never removed (for example if only the log write fails).
- Live preview: the `preview` IPC returns the overall count and, for several Brands, the count per Brand (shown as chips with "no records" warnings).

### A run (`processRun`)
Scan (unless already scanned) → plan selection → build output jobs → write to `<outputRoot>/<YYYY-MM-DD>/<RUN_YYYYMMDD_HHMMSS[_n]>/` → append **one** row to the central log → `RunResult` (`recordsRead`, `recordsSelected`, `recordsExported`, `recordsSkipped`, `warnings`, `languages`, `outputMode`, `files[]` with name, path, brand and record count). Failures and "no matching records" are logged too. Log columns include `Language Mode`, `Records Read/Selected/Exported/Skipped`, `Skipped Details`, `Output Mode`, `Output File Count`, `Output File Records` and `Output File Names`.

### Locations (`paths.ts`)
| | Windows | macOS |
|---|---|---|
| App data | `%APPDATA%\Split TM` | `~/Library/Application Support/Split TM` |
| inside it | `Logs/Processing_Log.xlsx`, `Backups/`, `Browser/` (Electron profile), `config.json`, `state.json` | same |
| Output (default, configurable) | `Documents\Split TM\TMX Output` | `~/Documents/Split TM/TMX Output` |

User data is never inside the install directory. Upgrade rules: PACKAGING.md.

**Platform layer:** everything that differs between operating systems is in `paths.ts` (`defaultPaths(overrides, platformInfo)`), plus the macOS-only application menu in `src/main/security.ts`. Shared code uses only `AppPaths`, `node:path`/`join` and never hard-codes separators, drive letters or `AppData`. `tests/platform.test.ts` checks the Windows, macOS and Linux locations from any host.

## 3b. Look and feel
The visual language is documented in [DESIGN.md](DESIGN.md). All colours, radii and tracking are CSS variables in `:root` of `src/renderer/styles.css`; add or change tokens there, not in individual rules. Fonts (Overpass 200/400/600) come from `@fontsource/overpass` and are bundled by Vite as separate files (`assetsInlineLimit: 0`), so the CSP only needs `font-src 'self'`. Only interface chrome is uppercase (via CSS `text-transform`, so the DOM text is unchanged and tests/automation keep working); data is never transformed.

## 4. Electron security model
- `contextIsolation`, `sandbox`, no `nodeIntegration`; the page only gets `window.splitTM` from `preload.ts`. CSP in `index.html`; window-open denied; navigation blocked; single instance.
- Every IPC handler validates input (extension and format allow-lists, folder exists) and returns `{ ok, data | error }`.
- Fuses at package time: `runAsNode` off, `NODE_OPTIONS` off, inspect args off, load only from asar, asar integrity on.
- **Build channel and Developer Tools** (`src/main/security.ts`, `scripts/build-main.mjs`): the channel is baked in at build time.

  | Build | Developer Tools, menu, shortcuts | Remote debugging switches |
  |---|---|---|
  | `npm run dev` (not packaged) | enabled | allowed |
  | developer channel (`build:dev`, `pack:dev`) | enabled; header shows "developer build" | allowed |
  | production (`build`, `pack`, `dist:*`) | **disabled**: `devTools:false`, F12 / Ctrl+Shift+I/J/C / Cmd+Opt+I and reload shortcuts blocked, no application menu (minimal Edit/Window menu on macOS) | **refused**: the app exits with code 2 |

  Verified on packaged Linux builds: F12 / Ctrl+Shift+I open DevTools in the developer build and do nothing in production.
- Inputs: ZIP entries are streamed (never written to disk); entries with `..`, absolute paths or drive letters are refused and reported as a warning; declared entry sizes are validated; there is no artificial file-size limit.
- Dev-only environment variables (ignored when packaged): `SPLITTM_DEV_URL`, `SPLITTM_TEST_FILES` (skip the file dialog, `|`-separated), `SPLITTM_SMOKE`.

### IPC contract (`src/shared/api.ts`)
`info`, `upgradeNotice`, `pickFiles`, `scan`, `count`, `preview` (live "N selected" plus per-Brand counts, language-aware), `process(filter, format, mode)`, `chooseOutputRoot`, `openPath`, `closeApp`, plus the `progress` event. A new channel needs three edits: `api.ts`, `preload.ts`, `main.ts` (with validation).

## 5. Extending the app

**Add an output format:** add the id to `OutputFormat` (`processor.ts`), the `FORMATS` list (`App.tsx`) and the IPC allow-list (`main.ts`); write a sink in `exporters.ts` (`createSink`), reusing `rowOf()` and the escaping helpers; add tests.

**Add a filter dimension:** field on `TranslationUnit` + `UnitMeta` (`model.ts`), fill it in `tmxParser.ts`/`metaOf`, criterion in `FilterCriteria` and `matchesFilter`, counts in `Dataset.facets()`, UI panel, log column.

**Add a log column:** append to `LOG_COLUMNS` and set it in `processor.ts`; bump `LOG_SCHEMA_VERSION`. Old logs are upgraded additively. Never rename or remove a column.

**Change settings shape:** add a step to `MIGRATIONS` in `config.ts`, bump `CONFIG_VERSION`.

**Replace the icon:** see PACKAGING.md ("Icons"); one folder, `build/`.

**Release:** bump `version` in `package.json` (single source of truth), `npm run verify`, tag `vX.Y.Z`; CI builds and checks Windows and macOS.

## 6. Error handling conventions
- Engine functions throw `Error` with an actionable message; `main.ts` converts it to `{ ok: false, error }`; the UI shows a banner.
- Startup migration never throws (returns a report). Log/config writes use temp file + rename; a locked log gives "Close … in Excel and try again".
- Never delete user data. The only deletions are stale `Temp/run-*` folders from older versions.

## 7. Testing
`npm test` (Vitest, 71 tests): parser mapping and inline tags (incl. self-closing, UTF-16), multi-brand counting, filtering, multi-source language selection (one/many sources and targets, All-to-All, blanks), skipped-record logging, CSV protection (`=SUM(A1:A10)`, `+123`, `-123`, `@example`, normal text, quotes/commas/newlines/Unicode, full round trip), Excel string safety and sheet rollover, streaming ZIP (traversal, corrupt, no TMX), input-changed guard, runs/log/migration, upgrade/downgrade, Developer Tools policy, Multiple Brand output (single brand, several brands in both modes, all four formats, language combinations, empty brands, name collisions, log row, older log, failure cleanup), Customer/Project/Approval/Date/status filters, and per-OS platform paths.

## 8. Tools, stress testing and debugging

**Headless CLI** (temp app-data/output unless `--app-data` / `--out` is given):
```bash
npm run cli -- scan sample.zip
npm run cli -- run sample.zip --brand Range_Rover --approval approved --format xlsx
npm run cli -- run a.tmx b.zip --source en-GB,de-DE --target fr-FR --format csv      # several sources, one file
npm run cli -- run a.tmx --all-to-all --format tmx
npm run cli -- gen-large /tmp/big.tmx --units 1000000 --langs 3                     # synthetic stress input
npm run cli -- validate-tmx sample.zip "<exported>.tmx"                              # exit 1 if any unit differs
```
Every command prints duration and peak memory.

**Large-file results** (synthetic 3-language TMX with context props, 4 GB RAM Linux VM, single process):

| Input | Run | Time | Peak memory |
|---|---|---|---|
| 300,000 units / 289 MB | CSV, 140,000 selected | 25 s | 257 MB |
| 300,000 units / 289 MB | Excel / TMX, 140,000 selected | 28 s / 24 s | 313 MB / 261 MB |
| 1,000,000 units / 964 MB | CSV, all units | 92 s | 392 MB |
| 1,000,000 units / 964 MB | Excel, all units | 135 s | 847 MB |

All 1,000,001 CSV lines / Excel rows were verified in the output. The previous in-memory design needed 1.3 GB at 300,000 units and then crashed (a `Math.min(...array)` stack overflow found by this very test). Re-run these before each production release, ideally with a real multi-million-unit TM.

**Packaged-app check:** `npm run pack:dev` then `node scripts/packaged-check.mjs "<app executable>"` (Linux: `release-dev/linux-unpacked/split-tm`, under `xvfb-run -a` if headless). 31 checks: launch, add TMX + ZIP, scan, skipped-unit reporting, language/filter counts, all four formats, output and log verification, close, reopen, process again, no leftover temp data. CI runs it on Windows, macOS and Linux. It needs a developer-channel build because production builds refuse the debugging port.

**UI smoke test:** `npm run smoke -- sample.zip` (built around the reference sample; on headless Linux use `xvfb-run -a`).

**Debugging:** dev window → *View → Toggle Developer Tools*; main-process logs in the `npm run dev` terminal; `electron --inspect=9229 .` after `npm run build:dev`. Reproduce logic bugs with `npm run cli` first.

## 9. Known limitations / backlog
- In *Separate Files* mode a unit with several selected Brands is repeated in each of its Brand files (by design); a Brand file's language columns can differ from another Brand's file.
- Large-file behaviour was measured on synthetic data only (1,000,000 units, section 8). The product owner confirmed multi-million-unit TMs are not expected; re-measure with a real TM before relying on very large inputs.
- Windows and macOS installers are built only in CI; the app has been run end to end on Linux only. Follow RELEASE_TEST.md on both before release. No signing certificates / notarization credentials yet; unsigned builds are not the final enterprise release.
- Excel output peaks at ~850 MB for 1,000,000 rows; the engine runs in the Electron main process (the UI stays responsive because parsing yields every chunk, but a worker/utility process would isolate very long runs).
- Source language codes are compared exactly as written (`en-GB` ≠ `en_GB` ≠ `en-gb`); input is read as UTF-8 or UTF-16 (BOM); other XML encodings are not supported.
- Inputs must not change between scanning and processing (detected and reported).
- The icon (`build/icon.png`) is a placeholder; the UI uses CSS 3D. A Three.js/WebGL layer is planned only where it adds real value and must be switchable off (performance, accessibility, low-end machines).
