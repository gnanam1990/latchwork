import type { PlanProposal, WorkspaceState } from './planning';
import type { RuntimeTool } from './agent-runtime';

export type WebMcpTool = RuntimeTool;

export interface ModelContextLike {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): void | Promise<void>;
}

export interface WorkspaceToolApi {
  getState(): WorkspaceState;
  findConflicts(): { conflicts: number; tightHandoffs: number; details: string[] };
  stageSaferPlan(): PlanProposal | null;
}

export type ToolRegistrationErrorHandler = (toolName: string, error: unknown) => void;

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

export function registerLatchworkTools(
  modelContext: ModelContextLike,
  api: WorkspaceToolApi,
  onError: ToolRegistrationErrorHandler = () => undefined,
): () => void {
  const controller = new AbortController();
  for (const tool of createLatchworkTools(api)) {
    try {
      const registration = modelContext.registerTool(tool, { signal: controller.signal });
      void Promise.resolve(registration).catch((error: unknown) => onError(tool.name, error));
    } catch (error) {
      onError(tool.name, error);
    }
  }
  return () => controller.abort();
}

export function installDocumentTools(
  api: WorkspaceToolApi,
  onError: ToolRegistrationErrorHandler = (toolName, error) => {
    console.error(`[Latchwork WebMCP] Failed to register ${toolName}`, error);
  },
): () => void {
  if (typeof document === 'undefined' || !document.modelContext) return () => undefined;
  return registerLatchworkTools(document.modelContext, api, onError);
}
