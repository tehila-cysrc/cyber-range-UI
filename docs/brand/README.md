# Brand

CySource brand pack — source material as received from the brand designer (logos, PP Mori font, brandbook).
Reference only; the app does not load files from here.

- `cysource-brandbook-v1.0.pdf` — logo rules (clear space, don'ts), colors, typography, grids.
- `logo/` — wordmark (green/black SVG+PNG) and the "S" mark (green SVG; black/white PDF+PNG only).
- `fonts/` — PP Mori TTFs. **Web license purchased with the brand kit** (confirmed 2026-10-06).
- `certificates/` — student certificate designs (HTML → PDF/PNG); see its README.

Web-ready copies used by the client:
- `client/src/assets/logo-wordmark-green.svg`, `logo-wordmark-white.svg` (white = black SVG with fill swapped; the brandbook defines a white logo).
- `client/public/favicon.svg` — the green "S" mark.
- `client/src/assets/fonts/PPMori-*.woff2` (Regular, RegularItalic, SemiBold, ExtraBold), converted with fontTools.

Colors and how they map to tokens: see the brand overlay note in `docs/DESIGN.md`.

Missing from the pack (ask the designer if needed): white wordmark SVG, black/white "S" mark as SVG.
