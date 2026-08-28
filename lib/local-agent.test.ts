import { describe, expect, it, vi } from 'vitest';
import { initialWorkspace } from './planning';
import {
  buildLocalAgentPrompt,
  parseLocalAgentDecision,
  runLocalAgent,
  type LocalTextModel,
} from './local-agent';

describe('Latchwork local agent', () => {
  it('builds a compact prompt that excludes final application capability', () => {
    const prompt = buildLocalAgentPrompt(initialWorkspace, 'Find a safer order');

    expect(prompt).toContain('stage_safer_plan');
    expect(prompt).toContain('never apply it');
    expect(prompt).not.toContain('apply_plan');
    expect(prompt).toContain('$12,500 ceiling');
  });

  it('accepts only the closed decision contract', () => {
    expect(parseLocalAgentDecision('{"action":"explain","rationale":"Two handoffs are tight."}')).toEqual({
      action: 'explain',
      rationale: 'Two handoffs are tight.',
    });
    expect(() => parseLocalAgentDecision('not json')).toThrow('malformed JSON');
    expect(() => parseLocalAgentDecision('{"action":"apply_plan","rationale":"Do it"}')).toThrow('unsupported action');
    expect(() => parseLocalAgentDecision('{"action":"none","rationale":"Safe","tool":"delete"}')).toThrow('unsupported fields');
  });

  it('stages a proposal without applying it or moving locked work', async () => {
    const model: LocalTextModel = {
      complete: vi.fn(async () => '{"action":"stage_safer_plan","rationale":"Verify dependencies first."}'),
    };
    const result = await runLocalAgent(model, initialWorkspace, 'Find a safer plan');

    expect(result.workspace.proposal).not.toBeNull();
    expect(result.workspace.steps).toEqual(initialWorkspace.steps);
    expect(result.workspace.steps.find(({ id }) => id === 'narrative')).toMatchObject({
      lane: 'now',
      position: 0,
      locked: true,
    });
  });

  it('does not mutate the workspace for explanatory decisions', async () => {
    const model: LocalTextModel = {
      complete: vi.fn(async () => '{"action":"explain","rationale":"The dependency handoff is the only risk."}'),
    };
    const result = await runLocalAgent(model, initialWorkspace, 'Explain the risks');

    expect(result.workspace).toBe(initialWorkspace);
    expect(result.workspace.proposal).toBeNull();
  });
});
