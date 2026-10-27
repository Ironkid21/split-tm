# Split TM — Visual assets and 3D/WebGL evaluation

Today the app draws everything with CSS (gradients, a rotating CSS cube, tilting cards, a perspective floor grid) and uses one placeholder icon (`build/icon.png`). That already looks finished, so the list below only asks for assets that add real value. Everything else is deliberately **not** requested.

## Design direction (for whoever makes the assets)
- Style: stark, technical, monochrome; thin lines (wireframe), no gradients, glows or photo-realism. See `DESIGN.md`.
- Colours (tokens in `src/renderer/styles.css`): black `#000000`, panel `#0B0B0B`, text `#F2F1F0`, greys `#9B9B9B` / `#6D6D6D`, single accent signal yellow `#F7E600`.
- Motif: the in-app logo is now **two offset wireframe squares** (one light, one accent). The current `build/icon.png` is an older placeholder in a different style; replace it with an icon built on the same motif: black rounded-square field, thin light square + accent square.
- Typeface for any lettering: Overpass (OFL), light weights, uppercase, wide tracking.
- Deliver the editable source (SVG / Figma / AI) as well as the exports below.

## A. Required before production

| # | Asset | Purpose and where it appears | Size / aspect | Transparency | Light/dark | Static/animated | Format |
|---|---|---|---|---|---|---|---|
| 1 | **App icon master** | Source for every platform icon; window icon | 1024 × 1024 px, 1:1. Keep the artwork inside ~824 px (macOS grid, ~10% margin); rounded-square shape drawn into the art | Yes (transparent outside the shape) | One version; must stay readable on light and dark taskbars/docks | Static | PNG 32-bit sRGB, plus SVG source |
| 2 | **Windows icon** | `.exe`, taskbar, Start menu, installer, uninstaller | One `.ico` containing 16, 24, 32, 48, 64, 128, 256 px (256 PNG-compressed), 1:1. Hand-simplify 16/24/32 so the motif stays clear | Yes | One version | Static | `.ico` → `build/icon.ico` |
| 3 | **macOS icon** | Dock, Finder, DMG, app switcher | `.icns` with 16, 32, 64, 128, 256, 512, 1024 px (and @2x pairs), 1:1, Apple icon grid | Yes | One version | Static | `.icns` → `build/icon.icns` |
| 4 | **In-app logo mark** | Header (top-left, shown at ~24 × 24 CSS px) and any About text. Replaces the CSS-drawn two-square mark (the SVG should keep the same motif) | Design at 64 × 64, 1:1, scales without blur | Yes | The UI is dark only; one version (a light variant only if a light theme is ever added) | Static | SVG → `src/renderer/assets/logo.svg` |

Items 2 and 3 can be generated from item 1, but hand-tuned small sizes look noticeably better. No code change is needed for 1–3 (electron-builder picks them up from `build/`); item 4 needs a two-line change in `App.tsx` to use the SVG.

## B. Recommended (small, clear benefit)

| # | Asset | Purpose and where it appears | Size / aspect | Transparency | Light/dark | Static/animated | Format |
|---|---|---|---|---|---|---|---|
| 5 | **macOS DMG background** | The window users see when installing: logo, "drag Split TM to Applications" arrow | 660 × 400 pt → 1320 × 800 px @2x (and 660 × 400 @1x), 33:20 | No (opaque) | Dark/neutral, works in light and dark Finder | Static | PNG → `build/background.png` (+ `dmg.background` entry in `electron-builder.yml`) |
| 6 | **Windows installer artwork** (only if the wizard installer stays) | Left banner and top strip of the setup wizard | Sidebar 164 × 314 px (≈1:1.9); header 150 × 57 px | No | Light wizard background, so use a light-safe design | Static | 24-bit BMP (+ `nsis` entries in `electron-builder.yml`) |
| 7 | **Upload / drop-zone illustration** | Intake screen centre ("Drop TMX or ZIP files here"); replaces the CSS cube if you want a custom look | 240 × 240 px display, 1:1, designed at 480 × 480 | Yes | Dark UI only | Static (a gentle CSS rotate/float can be added in code) | SVG |

## C. Deliberately not requested
- **Hero / dashboard background images:** the CSS gradient + grid is crisp at any resolution and adds no weight. A raster background would be larger, blurrier on high-DPI screens and clash with dense data panels.
- **Processing animation (video/Lottie):** the CSS orb and progress bar are enough and cost nothing. A video would add size and a dependency for no functional gain.
- **Completion visual, empty-state and error illustrations:** a check mark, plain text and a coloured banner are clearer for an enterprise tool than artwork.
- **File-type icons:** the "TMX" / "ZIP" tags are text; no images needed.

## D. WebGL / Three.js evaluation

**Current approach (CSS 3D):** no extra dependency, almost no GPU use, works in remote desktop sessions, honours "reduce motion", and is trivial to test.

**Where Three.js could genuinely help:** only two moments, the Intake hero (a real-time holographic data-cube or particle lattice that reacts when a file is dragged over) and the Processing screen (particles tied to real progress). The Select and Completion screens are dense data or confirmation screens; 3D adds nothing there.

**Costs and risks (typical figures, not measured in this project):**
- New dependency of roughly 150 KB gzipped for the core, plus the maintenance and supply-chain surface that comes with it.
- Continuous GPU/CPU use while visible; battery and fan noise on laptops.
- Enterprise users often work on virtual desktops (RDP, Citrix, VMs) with no GPU, or IT policies that disable WebGL. The interface must work fully without it.
- Harder to test (headless runs need software rendering).

**Recommendation: do not add it now.** Keep CSS 3D as the default. If the final branding stage wants more depth, add **one** lazy-loaded hero scene (loaded only on Intake/Processing, not in the main bundle) with these guard rails: automatically off when WebGL is unavailable, on `prefers-reduced-motion`, or when a new *Reduce visual effects* setting is on; capped at 30 fps and paused when the window is hidden; CSS version stays as the fallback; budget under ~150 KB gzipped added and negligible idle CPU.

**Decision gate:** build a prototype only after the final assets exist, measure it on a low-end Windows laptop and in a remote-desktop session, and keep it only if it clearly improves the first impression without slowing real work. I have not prototyped WebGL here, so the benefit side of this evaluation is a judgement, not a measurement.
