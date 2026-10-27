# Split TM — Design system

A stark, technical, monochrome interface: pure black, hairline structure, thin spaced capitals, wireframe 3D, and one signal colour reserved for the action that matters. Edit the tokens at the top of `src/renderer/styles.css`; avoid one-off colours in rules.

## Reference and what was adapted
The direction was inspired by a design-system capture of an automotive brand site (stark black background, wireframe rendering, uppercase light headlines, 0–3 px radii, muted greys, 1440 px content width). It was **adapted, not copied**: no logos, fonts, imagery or copy from that site are used. Typeface is Overpass (SIL Open Font License, bundled locally), the accent colour and every component are our own.

## Tokens
| Token | Value | Role |
|---|---|---|
| `--bg` | `#000000` | App background |
| `--surface` / `--surface-2` | `#0B0B0B` / `#131313` | Panels / hover and raised states |
| `--line` / `--line-strong` | `#262626` / `#424242` | Decorative hairlines and dividers |
| `--control` | `#6D6D6D` | Borders of interactive controls (≥ 3:1, WCAG 1.4.11) |
| `--ink` | `#F2F1F0` | Primary text |
| `--mute` / `--dim` | `#9B9B9B` / `#7F7F7F` | Secondary text / inactive labels |
| `--accent` | `#F7E600` | The one signal colour: primary button, active step, selected checkbox, progress, focus ring |
| `--ok` `--warn` `--err` | `#5FD38D` `#FF9A3C` `#FF5C5C` | Status only; deliberately different from the accent |
| `--r` | `2px` | Corner radius everywhere (0–3 px range) |

Measured contrast: body 18.6:1, muted 7.1:1, dim 4.9–5.2:1, accent on black 16.3:1, black on accent 16.3:1, control borders 3.8–4.1:1, status colours 6.5–10.5:1. Re-check after changing any token.

## Typography
Overpass, bundled in 200 / 400 / 600 (latin and latin-ext) so the app stays offline and the content-security policy stays strict.

| Use | Weight | Size | Tracking | Case |
|---|---|---|---|---|
| Screen titles (h1) | 200 | 28–30 px | 0.10 em | UPPERCASE |
| Big numerals (stats, selected count) | 200 | 26–34 px | 0.02 em | tabular figures |
| Panel / section labels (h2), buttons, steps | 600 / 400 | 11–12 px | 0.12–0.14 em | UPPERCASE |
| Body | 400 | 14 px, line-height 1.5 | 0 | normal |
| Hints, captions | 400 | 12 px | 0 | normal |

Rule: **only interface chrome is uppercase.** Data (brand names, file names, language names, segment text) always keeps its original case.

## Shape, layout, depth
- Radius 2 px; no pills, no blur, no drop shadows or glows. Structure comes from 1 px hairlines.
- Single column of rhythm: 32 px page margin, 14 px gaps between panels, 16–18 px panel padding.
- Depth is expressed with **wireframe 3D** only: the rotating edge-only cube (one accent face), the wireframe globe on the processing screen, and the receding grid floor.
- The primary Brand panel is marked with a 2 px accent top edge.

## Components
- **Buttons:** primary = accent fill, black text (one per screen where possible); secondary = outline; disabled primary turns neutral grey. Uppercase, 0.12 em tracking.
- **Selection:** native-feeling square checkboxes (accent when checked); segmented controls fill with light ink when active (neutral selection), so the accent stays reserved for actions.
- **Stat cards:** thin numeral over an uppercase label, hairline border, border brightens on hover.
- **Steps:** `01 ADD FILES — 02 SELECT — 03 EXPORT`, active step underlined in the accent.
- **Banners / notes:** dark surface with a 3 px left edge in the status colour (error, info = ink, warning).
- **Multiple Brand Output:** two outlined option cards (radio dot in the accent) plus per-Brand count chips.
- **Completion:** outlined accent tick, hairline key/value rows, file list with accent ticks.

## Motion and accessibility
- Animations are slow and few (cube, globe, grid drift, progress). `prefers-reduced-motion` switches all of them off.
- Visible focus ring in the accent on every control; every control is a real button/input.
- Colour is never the only signal (status banners also have text; selected states also change fill).

## Changing the look
1. Change a token in `:root` (accent, surfaces, radius, tracking).
2. Re-run the contrast table in this file's spirit (every text pair ≥ 4.5:1, control borders ≥ 3:1).
3. Run `npm run smoke -- <sample.zip>` to capture screenshots, and look at every screen.
