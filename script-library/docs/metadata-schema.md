# Script metadata schema

Each script file starts with a comment header. `catalog.json` mirrors the same fields.

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Stable kebab-case id (filename without extension) |
| `name` | yes | Instructor-facing title |
| `description` | yes | What it does |
| `expected_result` | yes | What success looks like on the VM / stdout |
| `target_os` | yes | `windows` \| `linux` \| `either` |
| `script_type` | yes | `powershell` \| `bash` (maps to DB) |
| `category` | yes | Folder / DB `scripts.category` |
| `required_permissions` | yes | e.g. local admin, domain admin, none |
| `expected_logs` | yes | OS / app logs produced |
| `qradar_visibility` | yes | What to search in QRadar |
| `complexity` | yes | `basic` \| `intermediate` \| `advanced` |
| `status` | yes | `implemented` \| `planned` |
| `mvp` | yes | boolean |
| `auto_inject_candidate` | no | boolean — safe for future timed fire |

## Inject metadata (`injects/*.yaml`)

| Field | Description |
| --- | --- |
| `id` | Inject id |
| `name` | Display name |
| `description` | Narrative for instructor |
| `target_role` | Topology role hint (`windows_server`, `domain_controller`, `linux_web`, …) |
| `trigger` | `manual` \| `elapsed_seconds` |
| `trigger_value` | Seconds after Start (if elapsed) |
| `script_id` | References `scripts/...` id |
| `expected_student_observations` | What analysts should notice |
| `instructor_notes` | Scoring / debrief hints (never auto-shown as student hints) |
