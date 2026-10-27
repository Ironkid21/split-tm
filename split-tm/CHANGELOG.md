## 1.5.3

- Updated Multiple Market Output panel labels and descriptions to match the requested behaviour.
- Individual Market Files exports one file per selected source-target pair; Single Combined File preserves combined multilingual output.
- Collapsed the long target-market list by default, added a Choose markets / Hide markets control, and removed numeric counts from target-market entries.
- Shows Multiple Market Output when more than one target market is selected.

## 1.5.2

- Added a separate language-market output mode: combined multilingual output or individual bilingual files per source-target pair.
- Individual market filenames include the brand prefix and source/target language codes (for example, `Defender_en-GB_it-IT`).
- Removed selected-brand chips/counts from the brand output selector and aligned brand/language output panels side by side when both apply.

# Changelog

## 1.5.1
- Added Multiple Market Output choices: Individual Market Files and Single Combined File.
- Removed the selected-market list and record counts from the output-mode panel; processing logic remains unchanged.


## 1.5.0
- Version number set to 1.5.0. No functional changes since 0.5.0 (new interface style, Multiple Brand output mode).

## 0.5.0
- **New interface style** (see `DESIGN.md`): stark black, monochrome greys, thin spaced uppercase headlines, 2 px corners, wireframe 3D (cube, globe, grid floor) and a single signal accent used for the main action, the active step and progress.
- Overpass typeface bundled locally (OFL); no network use, content-security policy unchanged apart from `font-src 'self'`.
- Interactive control borders raised to meet WCAG 3:1; reduced-motion respected.
- Behaviour, file formats and the log are unchanged.

## 0.4.0
- **Multiple Brand output mode:** with 2+ Brands selected, choose *Single File* (combined, each unit once) or *Separate Files* (one file per Brand). Works for TMX, Excel, CSV and Markdown; one Run ID and one run folder per run.
- Completion screen lists every generated file with its record count; *Close* button added.
- Log: `Output Mode`, `Output File Count`, `Output File Records` columns (older logs are extended automatically, history kept).
- Failed runs no longer leave partly written files behind.
- Date filter uses the creation date only.
- Platform layer made testable; Windows, macOS and Linux locations covered by tests.

## 0.3.0
- Streaming two-pass engine (index + export), no input copies on disk; multiple source languages, All-to-All, skipped-record logging, CSV formula protection, Developer Tools policy by build channel.

## 0.2.0
- Run management, central processing log, upgrade handling, packaging.

## 0.1.0
- Core engine, filters, four output formats, desktop UI.
