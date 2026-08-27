import { describe, expect, it } from 'vitest';
import {
  applyStagedProposal,
  calculateMetrics,
  initialWorkspace,
  stageSaferPlan,
  validateProposal,
  type PlanProposal,
} from './planning';

describe('Latchwork planning', () => {
  it('stages a safer plan without mutating the current workspace', () => {
    const staged = stageSaferPlan(initialWorkspace);

    expect(initialWorkspace.proposal).toBeNull();
    expect(staged.proposal?.after.tightHandoffs).toBe(0);
    expect(calculateMetrics(initialWorkspace.steps).tightHandoffs).toBe(2);
  });

  it('applies only the staged move and clears the proposal', () => {
    const applied = applyStagedProposal(stageSaferPlan(initialWorkspace));
    const dependencyCheck = applied.steps.find((step) => step.id === 'dependency-check');
    const lockedNarrative = applied.steps.find((step) => step.id === 'narrative');

    expect(dependencyCheck?.position).toBe(1);
    expect(lockedNarrative).toMatchObject({ lane: 'now', position: 0, locked: true });
    expect(applied.proposal).toBeNull();
  });

  it('rejects proposals that move locked work', () => {
    const unsafe: PlanProposal = {
      id: 'unsafe',
      title: 'Unsafe move',
      summary: 'Attempts to move locked work.',
      moves: [{ stepId: 'narrative', toLane: 'ready', toPosition: 0, reason: 'test' }],
      before: calculateMetrics(initialWorkspace.steps),
      after: calculateMetrics(initialWorkspace.steps),
    };

    expect(() => validateProposal(initialWorkspace, unsafe)).toThrow('Locked plan step cannot move');
  });
});
