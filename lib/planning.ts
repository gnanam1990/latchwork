export type LaneId = 'now' | 'next' | 'ready';

export interface Constraint {
  id: string;
  label: string;
  value: string;
  locked: true;
}

export interface PlanStep {
  id: string;
  title: string;
  owner: 'You' | 'Agent' | 'Together';
  minutes: number;
  lane: LaneId;
  position: number;
  locked?: boolean;
  accent?: boolean;
  launch?: boolean;
}

export interface PlanMove {
  stepId: string;
  toLane: LaneId;
  toPosition: number;
  reason: string;
}

export interface PlanMetrics {
  conflicts: number;
  tightHandoffs: number;
  focusedMinutes: number;
}

export interface PlanProposal {
  id: string;
  title: string;
  summary: string;
  moves: PlanMove[];
  before: PlanMetrics;
  after: PlanMetrics;
}

export interface WorkspaceState {
  scenario: string;
  constraints: Constraint[];
  steps: PlanStep[];
  proposal: PlanProposal | null;
}

export const initialWorkspace: WorkspaceState = {
  scenario: 'Fastest safe launch',
  constraints: [
    { id: 'launch', label: 'Launch', value: 'Friday · 5:00 PM', locked: true },
    { id: 'budget', label: 'Budget', value: '$12,500 ceiling', locked: true },
    { id: 'review', label: 'Review', value: 'Security sign-off', locked: true },
  ],
  steps: [
    { id: 'narrative', title: 'Finalize launch narrative', owner: 'You', minutes: 90, lane: 'now', position: 0, locked: true },
    { id: 'webmcp-tools', title: 'Connect WebMCP tools', owner: 'Agent', minutes: 120, lane: 'now', position: 1, accent: true },
    { id: 'dependency-check', title: 'Verify dependency graph', owner: 'Agent', minutes: 45, lane: 'now', position: 2 },
    { id: 'safety-review', title: 'Run safety review', owner: 'You', minutes: 60, lane: 'next', position: 0, locked: true },
    { id: 'demo', title: 'Prepare demo scenario', owner: 'Agent', minutes: 75, lane: 'next', position: 1 },
    { id: 'walkthrough', title: 'Publish walkthrough', owner: 'You', minutes: 30, lane: 'ready', position: 0 },
    { id: 'launch-step', title: 'Launch', owner: 'Together', minutes: 0, lane: 'ready', position: 1, launch: true },
  ],
  proposal: null,
};

export function calculateMetrics(steps: PlanStep[]): PlanMetrics {
  const tools = steps.find((step) => step.id === 'webmcp-tools');
  const dependencyCheck = steps.find((step) => step.id === 'dependency-check');
  const dependencyRisk = Boolean(
    tools &&
    dependencyCheck &&
    tools.lane === dependencyCheck.lane &&
    tools.position < dependencyCheck.position,
  );

  return {
    conflicts: 0,
    tightHandoffs: dependencyRisk ? 2 : 0,
    focusedMinutes: steps.reduce((total, step) => total + step.minutes, 0),
  };
}

export function stageSaferPlan(state: WorkspaceState): WorkspaceState {
  if (calculateMetrics(state.steps).tightHandoffs === 0) {
    return { ...state, proposal: null };
  }

  const move: PlanMove = {
    stepId: 'dependency-check',
    toLane: 'now',
    toPosition: 1,
    reason: 'Validate dependencies before connecting the WebMCP tool surface.',
  };

  const preview = applyMoves(state.steps, [move]);
  const proposal: PlanProposal = {
    id: 'safer-path-01',
    title: 'Safer dependency order',
    summary: 'Move dependency verification ahead of tool integration without changing locked work.',
    moves: [move],
    before: calculateMetrics(state.steps),
    after: calculateMetrics(preview),
  };

  validateProposal(state, proposal);
  return { ...state, proposal };
}

export function applyStagedProposal(state: WorkspaceState): WorkspaceState {
  if (!state.proposal) return state;
  validateProposal(state, state.proposal);
  return {
    ...state,
    steps: applyMoves(state.steps, state.proposal.moves),
    proposal: null,
  };
}

export function validateProposal(state: WorkspaceState, proposal: PlanProposal): void {
  for (const move of proposal.moves) {
    const step = state.steps.find((candidate) => candidate.id === move.stepId);
    if (!step) throw new Error(`Unknown plan step: ${move.stepId}`);
    if (step.locked && (step.lane !== move.toLane || step.position !== move.toPosition)) {
      throw new Error(`Locked plan step cannot move: ${step.id}`);
    }
  }
}

function applyMoves(steps: PlanStep[], moves: PlanMove[]): PlanStep[] {
  const next = steps.map((step) => ({ ...step }));

  for (const move of moves) {
    const moving = next.find((step) => step.id === move.stepId);
    if (!moving) continue;

    const targetLane = next
      .filter((step) => step.lane === move.toLane && step.id !== move.stepId)
      .sort((left, right) => left.position - right.position);
    targetLane.splice(Math.min(move.toPosition, targetLane.length), 0, moving);
    targetLane.forEach((step, index) => {
      step.lane = move.toLane;
      step.position = index;
    });
  }

  return next;
}
