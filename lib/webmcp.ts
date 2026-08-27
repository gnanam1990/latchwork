import type { PlanProposal, WorkspaceState } from './planning';

export interface WebMcpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
  };
  execute(input: Record<string, unknown>): unknown | Promise<unknown>;
}

export interface ModelContextLike {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): void | Promise<void>;
}

export interface WorkspaceToolApi {
  getState(): WorkspaceState;
  findConflicts(): { conflicts: number; tightHandoffs: number; details: string[] };
  stageSaferPlan(): PlanProposal;
}

declare global {
  interface Document {
    modelContext?: ModelContextLike;
  }
}

const emptyInputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

export function createLatchworkTools(api: WorkspaceToolApi): WebMcpTool[] {
  return [
    {
      name: 'get_workspace_state',
      title: 'Get workspace state',
      description: 'Read the current Latchwork scenario, locked constraints, plan steps, and staged proposal.',
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true },
      execute: () => api.getState(),
    },
    {
      name: 'find_constraint_conflicts',
      title: 'Find constraint conflicts',
      description: 'Inspect the current plan for conflicts and tight handoffs without changing the workspace.',
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true },
      execute: () => api.findConflicts(),
    },
    {
      name: 'stage_safer_plan',
      title: 'Stage a safer plan',
      description: 'Create a reviewable proposal that preserves every locked constraint. This does not apply changes.',
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: false },
      execute: () => api.stageSaferPlan(),
    },
  ];
}

export function registerLatchworkTools(modelContext: ModelContextLike, api: WorkspaceToolApi): () => void {
  const controller = new AbortController();
  for (const tool of createLatchworkTools(api)) {
    void modelContext.registerTool(tool, { signal: controller.signal });
  }
  return () => controller.abort();
}

export function installDocumentTools(api: WorkspaceToolApi): () => void {
  if (typeof document === 'undefined' || !document.modelContext) return () => undefined;
  return registerLatchworkTools(document.modelContext, api);
}
