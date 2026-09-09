# Subagent Pipeline (PubNub-proven)

5-stage subagent pipeline for going from raw requirement to merged, reviewed, security-cleared code. Each stage has scoped tools and a routed model — Haiku for cheap exploration, Sonnet for implementation, Opus for architecture and security where the cost of being wrong is highest.

## Stages

| # | Agent | Role | Model | Tools |
|---|-------|------|-------|-------|
| 1 | `pm-spec` | Read requirement, ask questions, write acceptance criteria | Haiku | `Read, WebFetch` |
| 2 | `architect-review` | Check against constraints, write ADR | Opus | `Read, Grep` |
| 3 | `implementer-tester` | Implement + tests + docs | Sonnet | `Edit, Write, Bash` |
| 4 | `code-reviewer` | Read-only, runs after every commit | Sonnet | `Read, Grep, Glob` |
| 5 | `security-reviewer` | Scan injection / auth / secrets | Opus | `Read, Grep` |

## Principles

- **Tool scoping.** PM and Architect are read-only. Implementer is the only writer. Reviewers are read-only. A stage cannot accidentally edit code it's reviewing.
- **Model routing.** Haiku for exploration / spec drafting (cheap, fast). Sonnet for implementation and code review (balanced). Opus for architecture decisions and security (where mistakes cost most).
- **Cost.** Routing buys 40–50% savings vs. running everything on Sonnet. Note: heavy multi-stage workflows can use 7× the tokens of a single direct call — don't run the pipeline for trivial changes.

## How to invoke

Each `.md` file in this directory is a Claude Code subagent definition. Drop them into `~/.claude/agents/` (user-level) or `<repo>/.claude/agents/` (project-level). Then call:

```
Agent({ subagent_type: "pm-spec", prompt: "..." })
Agent({ subagent_type: "architect-review", prompt: "..." })
Agent({ subagent_type: "implementer-tester", prompt: "..." })
Agent({ subagent_type: "code-reviewer", prompt: "..." })
Agent({ subagent_type: "security-reviewer", prompt: "..." })
```

Run them sequentially — each stage's output is the next stage's input. Reviewers (4, 5) can run in parallel after stage 3 commits.

## When to skip stages

- **One-line bug fix:** skip 1, 2. Go implementer → reviewer.
- **Pure refactor, no behavior change:** skip 1, 5.
- **Greenfield prototype:** all 5, but accept the ADR may be terse.
- **Production hotfix on a security-sensitive surface:** never skip 5.
