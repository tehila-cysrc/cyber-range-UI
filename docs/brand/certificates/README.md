# Certificates

Student completion certificates in the CySource brand (PP Mori, Eerie Black / Green Mage, unaltered wordmark).

- `source/` — original Canva templates as received (PDF + SVG), reference only.
- `designs/1-obsidian.html` — the chosen design (A4 landscape, shared setup in `designs/base.css`), final copy: AI Agent Compromise & Hybrid Incident Response; signed Amir Bar-El, CySource Founder. The three alternative variations were dropped once this one was picked (see git history if ever needed).
- `output/` — rendered PDF (vector, real text) + PNG (3x, 3369×2382 ≈ 290 dpi).

Render: `node docs/brand/certificates/render.mjs` (headless Chrome, falls back to Edge; `CHROME_PATH` overrides).
Sample text only (name, date) — edit the HTML and re-render.

**In the app:** design 1 is ported to React at `client/src/features/certificate/` (`Certificate.tsx` + `certificate.css`). Students get a green "Certificate" button in the top nav once eligible (team completed a scenario, or an instructor granted it in Roster → Students — `GET /teams/me/certificate`) — the only place students get it. Instructors can also download one for any student from Roster → Students. The student types the name and picks the date, and the PDF/PNG is generated in the browser (`html-to-image` + `jspdf`, lazy-loaded) — nothing is stored server-side. Keep the HTML design and the React port in sync when the copy changes.
