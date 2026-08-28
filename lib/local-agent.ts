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
    rationale: { type: 'string', minLength: 1, maxLength: 280 },
  },
  required: ['action', 'rationale'],
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
    'Return one JSON object matching the supplied schema. Do not include markdown.',
    'Allowed actions:',
    '- stage_safer_plan: prepare a reviewable proposal; never apply it.',
    '- explain: explain the current plan without changing it.',
    '- none: use when no safe action is needed.',
    'You cannot apply, delete, unlock, or directly mutate any workspace data.',
    `User instruction: ${JSON.stringify(instruction.trim())}`,
    `Workspace snapshot: ${JSON.stringify(snapshot)}`,
  ].join('\n');
}

export function parseLocalAgentDecision(raw: string): LocalAgentDecision {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Local model returned malformed JSON.');
  }

  if (!isPlainRecord(value)) throw new Error('Local model decision must be an object.');
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'action' || keys[1] !== 'rationale') {
    throw new Error('Local model decision contains unsupported fields.');
  }
  if (!LOCAL_AGENT_ACTIONS.includes(value.action as LocalAgentAction)) {
    throw new Error('Local model requested an unsupported action.');
  }
  if (typeof value.rationale !== 'string' || value.rationale.trim().length === 0 || value.rationale.length > 280) {
    throw new Error('Local model rationale is invalid.');
  }

  return { action: value.action as LocalAgentAction, rationale: value.rationale.trim() };
}

export async function runLocalAgent(
  model: LocalTextModel,
  state: WorkspaceState,
  instruction: string,
): Promise<LocalAgentResult> {
  if (!instruction.trim()) throw new Error('Enter a planning request first.');
  const decision = parseLocalAgentDecision(await model.complete(buildLocalAgentPrompt(state, instruction)));

  return {
    decision,
    workspace: decision.action === 'stage_safer_plan' ? stageSaferPlan(state) : state,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
