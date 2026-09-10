---
name: Obsidian Telemetry
colors:
  surface: '#031427'
  surface-dim: '#031427'
  surface-bright: '#2a3a4f'
  surface-container-lowest: '#000f21'
  surface-container-low: '#0b1c30'
  surface-container: '#102034'
  surface-container-high: '#1b2b3f'
  surface-container-highest: '#26364a'
  on-surface: '#d3e4fe'
  on-surface-variant: '#bbcabf'
  inverse-surface: '#d3e4fe'
  inverse-on-surface: '#213145'
  outline: '#86948a'
  outline-variant: '#3c4a42'
  surface-tint: '#4edea3'
  primary: '#4edea3'
  on-primary: '#003824'
  primary-container: '#10b981'
  on-primary-container: '#00422b'
  inverse-primary: '#006c49'
  secondary: '#7bd0ff'
  on-secondary: '#00354a'
  secondary-container: '#00a6e0'
  on-secondary-container: '#00374d'
  tertiary: '#ffb95f'
  on-tertiary: '#472a00'
  tertiary-container: '#e29100'
  on-tertiary-container: '#523200'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#6ffbbe'
  primary-fixed-dim: '#4edea3'
  on-primary-fixed: '#002113'
  on-primary-fixed-variant: '#005236'
  secondary-fixed: '#c4e7ff'
  secondary-fixed-dim: '#7bd0ff'
  on-secondary-fixed: '#001e2c'
  on-secondary-fixed-variant: '#004c69'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#031427'
  on-background: '#d3e4fe'
  surface-variant: '#26364a'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '600'
    lineHeight: 56px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.025em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: -0.015em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0.005em
  label-mono-lg:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.04em
  label-mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.08em
  code-block:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  space-xxs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  space-2xl: 3rem
  space-3xl: 4.5rem
  layout-max-width: 88rem
  gutter: 1.5rem
---

## Brand & Style

The design system is engineered for elite cyber operations, adversarial simulations, and CTF investigations where cognitive clarity under pressure is paramount. The platform rejects legacy "cyberpunk" tropes—neon green rain, gratuitous scanlines, terminal skeuomorphism, and noisy gauge clusters. Instead, it embodies a serene, high-precision instrument: calm, lethal in its efficiency, and immaculately quiet.

The aesthetic fuses **Precision Modernism** with **Deep Monochromatic Restraint**. Interfaces mimic military-grade aerospace telemetry consoles and Swiss high-modernist typography: massive breathing margins, hairline rules, deliberate mono-spaced telemetry, and stark obsidian surfaces with warm slate undertones.

The user must feel unhurried, razor-focused, and in total structural control of complex challenge networks. Every pixel of visual noise is treated as operational latency.

## Colors

The foundation is built on deep slate and graphite blacks rather than pitch voids, preserving spatial depth without harsh eye strain:

- **Surface Floor (`#090d12`)**: Deep slate-black canvas background providing warm, non-fatiguing absorption.
- **Surface Layer 1 (`#0f172a`)**: Structural panels, active investigation surfaces, and docked terminal drawers.
- **Surface Layer 2 (`#1e293b`)**: Discrete elevated chips, table headers, and focused item fills.
- **Surface Border (`#334155`)**: Ultra-fine containment lines (hairline 1px borders with 40-70% opacity).

### Signal Accents
Accents operate strictly as functional signals, never as decorative fills:
- **Primary / Emerald Signal (`#10b981`)**: Solved flags, active link nodes, captured objectives, and verified states. Rendered flat without fuzzy radial blooms.
- **Secondary / Deep Ice (`#38bdf8`)**: Target topologies, active investigation nodes, and routing hops.
- **Tertiary / Warm Amber (`#f59e0b`)**: In-progress exploitation attempts, vulnerability milestones, and time-sensitive debrief flags.
- **Alert / Crimson Flare (`#f43f5e`)**: IDS alerts, network isolation breaches, and unverified exploit paths.
- **Typography Primary (`#f8fafc`)**: Crisp slate-white with 100% legibility.
- **Typography Muted (`#94a3b8`)**: Secondary instructions and column meta descriptions.
- **Typography Telemetry (`#64748b`)**: Off-target telemetry, timestamps, and network hashes.

## Typography

Typography establishes an unyielding structural order. The pairing of **Inter** for narrative/editorial content with **JetBrains Mono** for machine-level metadata provides instant visual partitioning between strategic intelligence and real-time network payloads.

- **Headers**: Crisp, confident geometric weights with slight negative letter tracking to lock letterforms together cleanly on dark canvas backdrops.
- **Labels & Telemetry**: Always set in JetBrains Mono, uppercase, with generous positive tracking (`0.08em`) to mimic aerospace instrument panels and diagnostic hardware.
- **Numbers & Metrics**: Rendered tabular (`tnum`) in JetBrains Mono to avoid shifting column alignments when timers, flag counters, and score telemetry update in real-time.

## Layout & Spacing

The layout model enforces a **single dominant focus per screen**. Complex operations must not compete for attention.

### Grid & Structure
- **Max Width**: 1408px (`88rem`) centered canvas with generous edge gutters (`2rem` desktop, `1rem` mobile).
- **Rhythm**: Strict 8pt spatial cadence. Structural divisions rely on expansive negative space (`3rem` to `4.5rem`) rather than stacked nesting boxes.
- **Responsive Fluidity**:
  - **Desktop (>= 1280px)**: Persistent top horizontal navigation bar; expansive multi-column topology or two-column split-pane inspection view (60% network graph / 40% investigation log).
  - **Tablet (768px - 1279px)**: Split panes convert to vertically stacked or tabbed panels; horizontal secondary metrics collapse into clean single-line scrolling ribbons.
  - **Mobile (< 768px)**: Strict single-column stack. Heavy network graphs toggle into accessible structured list representations.

### Top Navigation Architecture
A minimalist horizontal bar locked to 56px height. Contains:
1. Micro brand-glyph (pure monochrome geometric polygon) + subtle system status dot.
2. 7 distinct primary navigation destinations:
   - `Home`
   - `Investigation`
   - `Topology`
   - `Milestones`
   - `Team`
   - `Leaderboard`
   - `Debrief`
3. Far-right tactical cluster: Session countdown timer (`tnum` JetBrains Mono) and operational identity chip.

## Elevation & Depth

Visual hierarchy uses **tonal layer stepping** paired with **hairline structural borders**. Floating drop shadows are eliminated; operational tooling requires planar clarity rather than fake atmospheric illumination.

- **Level 0 (Canvas)**: `#090d12`. The boundless foundational field.
- **Level 1 (Panels & Top Bar)**: `#0f172a` with a sharp 1px border of `rgba(51, 65, 85, 0.4)`. Used for the top persistent navigation, main challenge work surfaces, and topological containers.
- **Level 2 (Active Inspections / Modals)**: `#1e293b` with a 1px border of `rgba(100, 116, 139, 0.35)`. Used for command palettes, terminal drawers, and focused vulnerability cards.
- **Selection Highlight**: When an element is selected (e.g., a node in the network topology or an active milestone), depth is signaled not by lifting or casting shadows, but by changing the border state to a crisp, un-blurred 1px rule of `primary` (`#10b981`) or `secondary` (`#38bdf8`).

## Shapes

The design system maintains a **Soft Architectural (`1`)** shape language:
- Standard buttons, input fields, badges, and terminal blocks use a controlled `0.25rem` (4px) radius.
- Outer structural viewports, side sheets, and modal frames use `0.375rem` (6px) or `0.5rem` (8px).
- Status indicators, radar blips, and target state dots maintain absolute circles (`rounded-full`).

This restrained radius removes harsh needle-sharp corners while preventing the toy-like, rounded softness common in consumer software. Everything looks milled and precise.

## Components

### Buttons
- **Primary**: Solid crisp slate white (`#f8fafc`) background with deep slate text (`#090d12`), 4px corner radius, font `Inter` Medium 13px. Zero gradient. On hover: subtle shift to `#e2e8f0`.
- **Secondary / Ghost**: Transparent fill, 1px border in `rgba(51, 65, 85, 0.7)`, text `#f8fafc`. Hover: background fills to `rgba(30, 41, 59, 0.6)`.
- **Destructive / Flag Action**: Transparent with `#f43f5e` muted border; on press, solid muted crimson fill.

### Navigation Links (Top Bar)
- Flat inline text links in `Inter` 13px, weight 500.
- Inactive: `#94a3b8`.
- Active: `#f8fafc` with an understated 2px horizontal indicator bar positioned flush against the navigation bar's bottom edge (rendered in `#10b981`).

### Telemetry Badges & Chips
- Ultra-compact tags using `JetBrains Mono` 11px uppercase (`label-mono-sm`).
- Background: `rgba(15, 23, 42, 0.8)` with a 1px border matching the semantic status (e.g. emerald for `PWNED`, amber for `EXPLOITING`, slate for `UNREACHABLE`).
- Padding: 2px top/bottom, 6px left/right.

### Input Fields & Flag Submission
- Monospaced single-line input with zero background ornamentation.
- Hairline border (`#334155`). When active, transitions cleanly to 1px `#38bdf8` without diffuse glow rings.
- Prefix labels set to `JetBrains Mono` text `#64748b` (e.g., `flag{...}`).

### Lists & Telemetry Tables (Leaderboard / Milestones)
- Full-width flat rows separated by `1px solid rgba(51, 65, 85, 0.3)`.
- Zero zebra-striping. Hovering a row applies a slight surface shift to `#0f172a`.
- Data columns strictly aligned: names/identifiers left-aligned, timestamps and IP routes tabular mono, points/deltas right-aligned.

### Avatars & Icons
- **Avatar** (`client/src/components/Avatar.tsx`): a person's identity chip, wherever a username/display name appears (timeline authors, team rosters, help requests, scoring). Absolute circle per the Shapes rule above, 1px hairline border, `rgba(15, 23, 42, 0.8)` flat fill (no gradient), initials in `JetBrains Mono`. The border/text color is one of eight `--user-accent-*` tokens (`tokens.css`), picked deterministically from the name so the same person is always the same color everywhere — a rotating identity signal, not a decorative palette; several of the eight hues intentionally reuse the functional signal colors (`secondary`/cyan, `tertiary`/amber, `alert`/crimson) to stay in the same tonal register rather than introducing a separate rainbow.
- **Icons** (`client/src/components/icons.tsx`): thin-stroke (1.75px), `currentColor`, geometric line icons — never filled/skeuomorphic glyphs. Used sparingly at exactly two conceptual spots (an important-finding flag, a help-request life-ring) rather than as general-purpose decoration, per this system's "every pixel of visual noise is operational latency" principle.

### Network Topology Node Elements
- Minimal geometric nodes (hexagonal or clean rounded squares) with high-contrast state outlines:
  - Compromised: Crisp emerald perimeter with interior heartbeat ping.
  - Active Recon: Cyan perimeter.
  - Locked / Unscanned: Muted slate perimeter with dim typography.
- Connecting vector lines are razor-thin 1px paths (`#1e293b`), transitioning to solid white or cyan when traffic is actively sniffing or pivoting.