# Certificates

Student completion certificates in the CySource brand (PP Mori, Eerie Black / Green Mage, unaltered wordmark).

- `source/` — original Canva templates as received (PDF + SVG), reference only.
- `designs/*.html` — the brand redesigns (A4 landscape), shared setup in `designs/base.css`:
  1. `1-obsidian` — dark, matches the platform UI; "verified" seal with the S mark.
  2. `2-ice-minimal` — light minimalist (from *White and Black Minimalist*).
  3. `3-signal-bands` — angled corner bands + ribbon (from *Green and Gold*).
  4. `4-arc-seal` — curved left panel + rosette seal (from *Black and Gold*).
- `output/` — rendered PDF (vector, real text) + PNG (3x, 3369×2382 ≈ 290 dpi).

Render: `node docs/brand/certificates/render.mjs` (headless Chrome, falls back to Edge; `CHROME_PATH` overrides).
Sample text only (name "Alex Morgan", "Instructor Name", date) — edit the HTML and re-render. Not wired into the app.
