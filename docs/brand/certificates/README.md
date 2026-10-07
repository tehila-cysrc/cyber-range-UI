# Certificates

Student completion certificates in the CySource brand (PP Mori, Eerie Black / Green Mage, unaltered wordmark).

- `source/` — original Canva templates as received (PDF + SVG), reference only.
- `designs/*.html` — the brand redesigns (A4 landscape), shared setup in `designs/base.css`:
  1. `1-obsidian` — **chosen design**, final copy (AI Agent Compromise & Hybrid Incident Response; signed Amir Bar-El, CySource Founder). Dark, matches the platform UI.
  2. `2-ice-minimal` — light minimalist (from *White and Black Minimalist*).
  3. `3-signal-bands` — angled corner bands + ribbon (from *Green and Gold*).
  4. `4-arc-seal` — curved left panel + rosette seal (from *Black and Gold*).
- `output/` — rendered PDF (vector, real text) + PNG (3x, 3369×2382 ≈ 290 dpi).

Render: `node docs/brand/certificates/render.mjs` (headless Chrome, falls back to Edge; `CHROME_PATH` overrides).
Sample text only (name, date) — edit the HTML and re-render.

**In the app:** design 1 is ported to React at `client/src/features/certificate/` (`Certificate.tsx` + `certificate.css`). Students get a "Download certificate" button on a completed scenario (Investigation read-only banner, Debrief summary); they type the name and pick the date, and the PDF/PNG is generated in the browser (`html-to-image` + `jspdf`, lazy-loaded) — nothing is stored server-side. Keep the HTML design and the React port in sync when the copy changes.
