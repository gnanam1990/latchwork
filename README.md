# Latchwork

**Lock what matters. Solve the rest.**

Latchwork is a private, constraint-aware planning workspace where a person fixes the decisions that must not move and an agent explores safer alternatives around them.

The foundation includes a working visual planning board, deterministic proposal staging, human-only final application, and real browser WebMCP tool registration through `document.modelContext.registerTool(...)`.

## Current foundation

- Visual planning lanes and locked constraints
- Deterministic conflict and handoff analysis
- Reviewable staged plan changes
- Human-controlled final apply action
- WebMCP tools with read-only annotations and abort-signal cleanup
- Unit tests for lock enforcement, proposal application, and the WebMCP surface
- Pull-request CI covering lint, type safety, tests, production build, and dependency audit

The current planner is deterministic. A browser-local language model will be integrated in a later pull request; the UI does not send workspace data to an external model.

## WebMCP tools

| Tool | Purpose | Agent can apply final changes? |
| --- | --- | --- |
| `get_workspace_state` | Read the scenario, constraints, steps, and staged proposal | No |
| `find_constraint_conflicts` | Inspect conflicts and tight handoffs | No |
| `stage_safer_plan` | Prepare a proposal that preserves locked work | No |

Final application stays in the visible human interface.

## Local development

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Run the complete merge gate:

```bash
npm run verify
```

## Repository workflow

After the one-time repository bootstrap, changes reach `main` only through a feature branch and pull request. A pull request must include local verification evidence, pass GitHub CI, and receive an evidence-based code review before merge. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
