import { calculateMetrics, stageSaferPlan, type WorkspaceState } from './planning';

export const LOCAL_AGENT_ACTIONS = ['stage_safer_plan', 'explain', 'none'] as const;

export type LocalAgentAction = (typeof LOCAL_AGENT_ACTIONS)[number];

export interface LocalAgentDecision {
  action: LocalAgentAction;
  rationale: string;
}

export interface LocalTextModel {
  complete(prompt: string): Promise<string>;
  dispose?(): void | Promise<void>;
}

export interface LocalAgentResult {
  decision: LocalAgentDecision;
  workspace: WorkspaceState;
}

export function acceptLocalAgentResult(
  result: LocalAgentResult,
  startedAtRevision: number,
  currentRevision: number,
): WorkspaceState | null {
  return startedAtRevision === currentRevision ? result.workspace : null;
}

const decisionSchema = {
  type: 'object',
  properties: {
    action: { enum: LOCAL_AGENT_ACTIONS },
  },
  required: ['action'],
  additionalProperties: false,
} as const;

export function getLocalAgentDecisionSchema(): string {
  return JSON.stringify(decisionSchema);
}

export function buildLocalAgentPrompt(state: WorkspaceState, instruction: string): string {
  const metrics = calculateMetrics(state.steps);
  const snapshot = {
    scenario: state.scenario,
    lockedConstraints: state.constraints.map(({ label, value }) => ({ label, value })),
    steps: state.steps.map(({ id, title, owner, lane, position, locked }) => ({
      id,
      title,
      owner,
      lane,
      position,
      locked: Boolean(locked),
    })),
    metrics,
    proposalStaged: Boolean(state.proposal),
  };

  return [
    'You are Latchwork, a browser-local planning collaborator.',
    'Choose exactly one action and return only JSON, for example {"action":"explain"}.',
    'Action rules:',
    '- stage_safer_plan: choose this when the user asks to find, prepare, or stage a safer plan.',
    '- explain: choose this when the user asks to inspect, explain, summarize, or identify risks.',
    '- none: choose this only when the user explicitly asks for no action or no safe action is needed.',
    'Locked work must stay fixed, but stage_safer_plan may move unlocked work in a proposal.',
    'Do not choose none merely because the user says locked work must not move.',
    'Example: "Find a safer plan without moving locked work" means {"action":"stage_safer_plan"}.',
    'Example: "Explain the current risks" means {"action":"explain"}.',
    'Example: "Keep the plan unchanged" means {"action":"none"}.',
    'A staged plan is only a reviewable proposal. It is never applied automatically.',
    'You cannot apply, delete, unlock, or directly mutate any workspace data.',
    `User instruction: ${JSON.stringify(instruction.trim())}`,
    `Workspace snapshot: ${JSON.stringify(snapshot)}`,
  ].join('\n');
}

export function parseLocalAgentDecision(raw: string, state: WorkspaceState): LocalAgentDecision {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Local model returned malformed JSON.');
  }

  if (!isPlainRecord(value)) throw new Error('Local model decision must be an object.');
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'action') {
    throw new Error('Local model decision contains unsupported fields.');
  }
  if (!LOCAL_AGENT_ACTIONS.includes(value.action as LocalAgentAction)) {
    throw new Error('Local model requested an unsupported action.');
  }

  const action = value.action as LocalAgentAction;
  return { action, rationale: rationaleForAction(action, state) };
}

function rationaleForAction(action: LocalAgentAction, state: WorkspaceState): string {
  const metrics = calculateMetrics(state.steps);
  if (action === 'stage_safer_plan') {
    return metrics.tightHandoffs > 0
      ? `The plan has ${metrics.tightHandoffs} tight handoffs. One lock-preserving change is staged for review.`
      : 'The current plan has no tight handoffs, so no proposal was staged.';
  }
  if (action === 'explain') {
    return `The plan preserves every locked constraint and currently has ${metrics.conflicts} conflicts and ${metrics.tightHandoffs} tight handoffs.`;
  }
  return 'No workspace change was requested, so the current plan remains untouched.';
}

export async function runLocalAgent(
  model: LocalTextModel,
  state: WorkspaceState,
  instruction: string,
): Promise<LocalAgentResult> {
  if (!instruction.trim()) throw new Error('Enter a planning request first.');
  const decision = parseLocalAgentDecision(
    await model.complete(buildLocalAgentPrompt(state, instruction)),
    state,
  );

  return {
    decision,
    workspace: decision.action === 'stage_safer_plan' ? stageSaferPlan(state) : state,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
