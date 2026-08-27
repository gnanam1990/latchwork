import { describe, expect, it, vi } from 'vitest';
import { initialWorkspace, stageSaferPlan } from './planning';
import { createLatchworkTools, registerLatchworkTools, type ModelContextLike, type WebMcpTool } from './webmcp';

const api = {
  getState: () => initialWorkspace,
  findConflicts: () => ({ conflicts: 0, tightHandoffs: 2, details: ['Dependency verification follows integration.'] }),
  stageSaferPlan: () => stageSaferPlan(initialWorkspace).proposal!,
};

describe('Latchwork WebMCP tools', () => {
  it('exposes read and stage capabilities with honest annotations', () => {
    const tools = createLatchworkTools(api);

    expect(tools.map((tool) => tool.name)).toEqual([
      'get_workspace_state',
      'find_constraint_conflicts',
      'stage_safer_plan',
    ]);
    expect(tools.find((tool) => tool.name === 'get_workspace_state')?.annotations.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'stage_safer_plan')?.annotations.readOnlyHint).toBe(false);
  });

  it('keeps final application outside the agent tool surface', () => {
    const names = createLatchworkTools(api).map((tool) => tool.name);
    expect(names).not.toContain('apply_plan');
  });

  it('registers tools with a shared abort signal for cleanup', () => {
    const registered: Array<{ tool: WebMcpTool; signal?: AbortSignal }> = [];
    const context: ModelContextLike = {
      registerTool: vi.fn((tool, options) => {
        registered.push({ tool, signal: options?.signal });
      }),
    };

    const cleanup = registerLatchworkTools(context, api);
    expect(registered).toHaveLength(3);
    expect(registered.every(({ signal }) => signal && !signal.aborted)).toBe(true);

    cleanup();
    expect(registered.every(({ signal }) => signal?.aborted)).toBe(true);
  });
});
