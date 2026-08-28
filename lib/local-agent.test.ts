import { describe, expect, it, vi } from 'vitest';
import { applyStagedProposal, calculateMetrics, initialWorkspace, stageSaferPlan } from './planning';
import {
  acceptLocalAgentResult,
  buildLocalAgentPrompt,
  parseLocalAgentDecision,
  runLocalAgent,
  type LocalTextModel,
} from './local-agent';

describe('Latchwork local agent', () => {
  it('builds a compact prompt that excludes final application capability', () => {
    const prompt = buildLocalAgentPrompt(initialWorkspace, 'Find a safer order');

    expect(prompt).toContain('stage_safer_plan');
    expect(prompt).toContain('never applied automatically');
    expect(prompt).toContain('may move unlocked work');
    expect(prompt).not.toContain('apply_plan');
    expect(prompt).toContain('$12,500 ceiling');
  });

  it('accepts only the closed decision contract', () => {
    expect(parseLocalAgentDecision('{"action":"explain"}', initialWorkspace)).toEqual({
      action: 'explain',
      rationale: 'The plan preserves every locked constraint and currently has 0 conflicts and 2 tight handoffs.',
    });
    expect(() => parseLocalAgentDecision('not json', initialWorkspace)).toThrow('malformed JSON');
    expect(() => parseLocalAgentDecision('{"action":"apply_plan"}', initialWorkspace)).toThrow('unsupported action');
    expect(() => parseLocalAgentDecision('{"action":"none","tool":"delete"}', initialWorkspace)).toThrow('unsupported fields');
  });

  it('stages a proposal without applying it or moving locked work', async () => {
    const model: LocalTextModel = {
      complete: vi.fn(async () => '{"action":"stage_safer_plan"}'),
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
      complete: vi.fn(async () => '{"action":"explain"}'),
    };
    const result = await runLocalAgent(model, initialWorkspace, 'Explain the risks');

    expect(result.workspace).toBe(initialWorkspace);
    expect(result.workspace.proposal).toBeNull();
  });

  it('explains the current metrics after an approved plan removes the handoffs', async () => {
    const appliedWorkspace = applyStagedProposal(stageSaferPlan(initialWorkspace));
    const model: LocalTextModel = {
      complete: vi.fn(async () => '{"action":"explain"}'),
    };

    expect(calculateMetrics(appliedWorkspace.steps).tightHandoffs).toBe(0);
    const result = await runLocalAgent(model, appliedWorkspace, 'Explain the current plan');

    expect(result.workspace).toBe(appliedWorkspace);
    expect(result.decision.rationale).toContain('0 conflicts and 0 tight handoffs');
    expect(result.decision.rationale).not.toContain('2 tight handoffs');
  });

  it('rejects an in-flight result after the workspace revision changes', async () => {
    const model: LocalTextModel = {
      complete: vi.fn(async () => '{"action":"stage_safer_plan"}'),
    };
    const result = await runLocalAgent(model, initialWorkspace, 'Find a safer plan');

    expect(acceptLocalAgentResult(result, 4, 5)).toBeNull();
    expect(acceptLocalAgentResult(result, 4, 4)).toBe(result.workspace);
  });
});
