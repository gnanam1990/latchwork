# Local Runtime Benchmark

Date: 2026-08-28  
Model: `Llama-3.2-1B-Instruct-q4f16_1-MLC`  
Runtime: WebLLM worker with WebGPU and IndexedDB model caching

## Result

The browser-local runtime is functional and preserves Latchwork's safety boundary. After simplifying the model contract to a single closed action field and adding explicit locked-versus-unlocked examples, all three acceptance prompts selected the expected action. These three cases are a focused smoke test, not a broad model-quality claim.

| Prompt | Expected | Actual | Latency | Workspace effect |
| --- | --- | --- | ---: | --- |
| `Find a safer plan without moving locked work.` | `stage_safer_plan` | `stage_safer_plan` | 1.2 s | Staged one reviewable proposal |
| `Explain the current risks.` | `explain` | `explain` | 1.3 s | No mutation |
| `Keep the plan unchanged.` | `none` | `none` | 980 ms | No mutation |

The staged result did not move any plan step immediately. The final **Apply proposed plan** button remained a separate human action and was not clicked during the benchmark.

## Model loading

- The default Cache API backend failed in both tested Chromium surfaces with `Cache.add() encountered a network error`.
- Switching WebLLM to its supported IndexedDB backend allowed the model weights to download and persist.
- The first download reached approximately 664 MB across 22 shards. One transient IndexedDB connection-close error occurred; a manual retry resumed the cached download and completed.
- Observed cold-path model progress time was approximately 331 seconds across the interrupted attempt and resumed retry.
- An observed cached reload completed in approximately 3.8 seconds.
- The UI now distinguishes the approximately 0.66 GB model download from the approximately 0.9 GB WebGPU memory requirement.

## Contract finding

The first two live prompts used a schema requiring both `action` and free-form `rationale`. Both returned valid JSON but selected `none` when `stage_safer_plan` was expected. Removing free-form generation from the model contract was not enough by itself; the 1B model also needed explicit examples clarifying that locked work stays fixed while unlocked work may be moved in a staged proposal.

The final contract accepts only:

```json
{"action":"stage_safer_plan"}
```

where `action` is one of `stage_safer_plan`, `explain`, or `none`. Latchwork validates the action, creates the user-facing rationale in trusted application code, and routes staging through the deterministic lock-preserving planner.

## WebMCP proof

The live page registered three document tools:

- `get_workspace_state` — read-only workspace snapshot
- `find_constraint_conflicts` — read-only conflict and handoff analysis
- `stage_safer_plan` — stages a proposal without applying it

Live calls confirmed that the workspace began with no proposal, reported zero conflicts and two tight handoffs, and staged one proposal that reduced the projected tight handoffs to zero. Locked constraints and plan steps remained unchanged until human approval.

## Acceptance status

- Browser WebGPU detection: pass
- Dedicated WebLLM worker: pass
- IndexedDB download and cached reload: pass, with one resumable cold-download interruption observed
- Closed JSON decision validation: pass
- Focused three-intent smoke test: 3/3 pass
- Deterministic proposal staging: pass
- Locked-work preservation: pass
- Human-only final application: pass
- Broad prompt robustness, lower-memory devices, and additional browser families: not yet measured
