# Script & Inject Library

Catalog of **safe, instructor-controlled** scripts for the Cyber Range Instructor Console (`Run Script` → Azure Run Command).

## Purpose

Generate **detectable, investigable** activity in the lab (logs, audit events, service changes) — not real attacks.

## How this maps to the product

| This folder | Product |
| --- | --- |
| `scripts/**/*.ps1` / `*.sh` | Rows in CONFIG table `scripts` (`script_type`, `category`, `content`) |
| `injects/*.yaml` | Future inject definitions (Trigger → script → target role) |
| `scenario-packs/*` | Ordered inject sequences for a training day |

Import into the DB is manual for now (Script Library UI or seed). Auto-import is out of scope for this catalog.

## Layout

```
script-library/
├── README.md                 ← you are here
├── PRIORITIES.md             ← MVP / later / never-as-attack
├── CATALOG.md                ← human index of every script
├── catalog.json              ← machine-readable index (future seed)
├── AGENT_SIMULATOR_INTEGRATION.md ← ai-agent tool table + adapter integration notes
├── agent-tools/               ← ToolDeclaration catalog + adapter for the external Agent Simulator
│   ├── catalog.json
│   ├── adapter.mjs
│   ├── adapter.test.mjs
│   └── verify.mjs
├── docs/
│   ├── safety.md
│   ├── metadata-schema.md
│   └── qradar-pipeline.md
├── scripts/
│   ├── basic-health/
│   ├── user-activity/
│   ├── administrative/
│   ├── infrastructure/
│   ├── web/
│   ├── logging/
│   ├── qradar/
│   ├── active-directory/
│   ├── cloud/
│   └── ai-agent/             ← normal/suspicious/adversarial-simulated capabilities for the Agent Simulator
├── injects/                  ← inject definitions (reference scripts by id)
└── scenario-packs/
    ├── beginner/
    ├── soc-analyst/
    ├── active-directory/
    ├── azure/
    └── qradar-validation/
```

## Complexity

- **Basic** — one command or few lines; low blast radius; MVP
- **Intermediate** — multi-step, needs domain/admin, or multi-host assumptions
- **Advanced** — reserved for carefully reviewed packs; still non-attack

## Safety (summary)

See `docs/safety.md`. Hard rules: no exploit payloads, no credential dumping, no ransomware simulation, no destructive wipe, no external C2. Prefer reversible admin actions and clearly tagged marker strings (`CR-SCRIPT-*`) so analysts can find events in QRadar.
