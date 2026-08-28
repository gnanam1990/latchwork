# Latchwork

**Lock what matters. Solve the rest.**

Latchwork is a private, constraint-aware planning workspace where a person fixes the decisions that must not move and an agent explores safer alternatives around them.

The foundation includes a working visual planning board, browser-local language-model reasoning, deterministic proposal staging, human-only final application, and real browser WebMCP tool registration through `document.modelContext.registerTool(...)`.

## Current foundation

- Visual planning lanes and locked constraints
- Deterministic conflict and handoff analysis
- Optional Llama 3.2 1B inference in a dedicated Web Worker through WebLLM
- Schema-constrained local decisions with a closed `stage_safer_plan`, `explain`, or `none` action set
- Reviewable staged plan changes
- Human-controlled final apply action
- WebMCP tools with read-only annotations and abort-signal cleanup
- Unit tests for lock enforcement, proposal application, and the WebMCP surface
- Pull-request CI covering lint, type safety, tests, production build, and dependency audit

The deterministic safety planner remains available without a model. On WebGPU-capable browsers, the user can explicitly load `Llama-3.2-1B-Instruct-q4f16_1-MLC` and ask it to reason over the current workspace. The model artifact is downloaded and cached by the browser on first use (approximately 0.9 GB); inference and workspace prompts then stay in the browser.

Model output is untrusted. Latchwork constrains it to a JSON decision schema, rejects malformed or unsupported actions, and passes accepted staging requests through the same deterministic lock-preserving planner. A model cannot directly mutate the workspace or apply a proposal.

## Local model states

| State | What happens |
| --- | --- |
| WebGPU ready, model unloaded | The deterministic safe planner works; model download starts only after an explicit click |
| Model loading | Download and initialization progress is shown in the agent panel |
| Model ready | Requests run in a dedicated browser worker and validated decisions may stage a proposal |
| Unsupported or failed | The failure is shown honestly; deterministic planning remains available |

## WebMCP tools

| Tool | Purpose | Agent can apply final changes? |
| --- | --- | --- |
| `get_workspace_state` | Read the scenario, constraints, steps, and staged proposal | No |
| `find_constraint_conflicts` | Inspect conflicts and tight handoffs | No |
| `stage_safer_plan` | Prepare a proposal that preserves locked work | No |

Final application stays in the visible human interface.

The model receives only the current scenario snapshot needed for its decision. No API key or hosted inference service is used.

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
