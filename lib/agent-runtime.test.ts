import { describe, expect, it, vi } from 'vitest';
import {
  AgentRuntimeError,
  buildAgentRuntimePrompt,
  parseAgentDecision,
  runAgentRuntime,
  type RuntimeModel,
  type RuntimeTool,
} from './agent-runtime';

function sequenceModel(decisions: string[]): RuntimeModel {
  let index = 0;
  return {
    generate: vi.fn(async () => decisions[index++] ?? '{"type":"final","message":"Done"}'),
  };
}

function tool(overrides: Partial<RuntimeTool> & Pick<RuntimeTool, 'name' | 'execute'>): RuntimeTool {
  return {
    title: overrides.name,
    description: `${overrides.name} test tool`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    ...overrides,
  };
}

describe('agent-native runtime', () => {
  it('uses intermediate tool results across a bounded multi-step run', async () => {
    const searchFlights = vi.fn(async () => ({ optionId: 'flight-17', priceInr: 42_000 }));
    const inspectFare = vi.fn(async (input) => ({
      optionId: input.optionId,
      redEye: false,
    }));
    const model = sequenceModel([
      '{"type":"tool_call","tool":"search_flights","input":{"destination":"Japan"}}',
      '{"type":"tool_call","tool":"inspect_fare","input":{"optionId":"flight-17"}}',
      '{"type":"final","message":"Found a non-red-eye option under the trip budget."}',
    ]);
    const tools: RuntimeTool[] = [
      tool({
        name: 'search_flights',
        inputSchema: {
          type: 'object',
          properties: { destination: { type: 'string' } },
          required: ['destination'],
          additionalProperties: false,
        },
        execute: searchFlights,
      }),
      tool({
        name: 'inspect_fare',
        inputSchema: {
          type: 'object',
          properties: { optionId: { type: 'string' } },
          required: ['optionId'],
          additionalProperties: false,
        },
        execute: inspectFare,
      }),
    ];

    const result = await runAgentRuntime({
      goal: 'Find a Japan flight without a red-eye.',
      model,
      getTools: () => tools,
    });

    expect(result.status).toBe('completed');
    expect(result.history).toHaveLength(2);
    expect(inspectFare).toHaveBeenCalledWith({ optionId: 'flight-17' }, { signal: undefined });
    expect(model.generate).toHaveBeenCalledTimes(3);
    const secondPrompt = vi.mocked(model.generate).mock.calls[1][0].prompt;
    expect(secondPrompt).toContain('flight-17');
    expect(result.events.map(({ type }) => type)).toContain('completed');
  });

  it('refreshes the tool surface before every model step', async () => {
    let detailsAvailable = false;
    const search = tool({
      name: 'search',
      execute: () => {
        detailsAvailable = true;
        return { id: 'result-1' };
      },
    });
    const details = tool({ name: 'get_details', execute: () => ({ ready: true }) });
    const getTools = vi.fn(() => detailsAvailable ? [search, details] : [search]);
    const model = sequenceModel([
      '{"type":"tool_call","tool":"search","input":{}}',
      '{"type":"tool_call","tool":"get_details","input":{}}',
      '{"type":"final","message":"Complete"}',
    ]);

    const result = await runAgentRuntime({ goal: 'Complete the lookup.', model, getTools });

    expect(result.status).toBe('completed');
    expect(getTools).toHaveBeenCalledTimes(3);
    expect(result.events.filter(({ type }) => type === 'tools_refreshed')).toHaveLength(3);
  });

  it('rejects malformed tool metadata before asking the model', async () => {
    const execute = vi.fn();
    const model = sequenceModel(['{"type":"final","message":"Unsafe"}']);
    const malformedTool = tool({
      name: 'unsafe_tool',
      annotations: { readOnlyHint: 'false' as unknown as boolean },
      execute,
    });

    await expect(runAgentRuntime({
      goal: 'Stay safe.',
      model,
      getTools: () => [malformedTool],
    })).rejects.toThrow('readOnlyHint must be boolean');
    expect(model.generate).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('normalizes model tool names and rejects malformed registry names', async () => {
    const execute = vi.fn(() => ({ inspected: true }));
    const result = await runAgentRuntime({
      goal: 'Inspect safely.',
      model: sequenceModel([
        '{"type":"tool_call","tool":" inspect ","input":{}}',
        '{"type":"final","message":"Done"}',
      ]),
      getTools: () => [tool({ name: 'inspect', execute })],
    });

    expect(result.status).toBe('completed');
    expect(execute).toHaveBeenCalledOnce();

    const malformed = tool({ name: 17 as unknown as string, execute });
    await expect(runAgentRuntime({
      goal: 'Reject malformed tools.',
      model: sequenceModel(['{"type":"final","message":"Unsafe"}']),
      getTools: () => [malformed],
    })).rejects.toThrow('string name');
  });

  it('rejects invalid input before a tool executes', async () => {
    const execute = vi.fn();
    const model = sequenceModel([
      '{"type":"tool_call","tool":"search_flights","input":{"destination":17}}',
    ]);
    const tools = [tool({
      name: 'search_flights',
      inputSchema: {
        type: 'object',
        properties: { destination: { type: 'string' } },
        required: ['destination'],
        additionalProperties: false,
      },
      execute,
    })];

    await expect(runAgentRuntime({ goal: 'Search.', model, getTools: () => tools }))
      .rejects.toThrow('input.destination must be string');
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed on unsupported schema assertions and validates additional properties', async () => {
    const unsupportedExecute = vi.fn();
    const unsupportedTool = tool({
      name: 'search',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 3 } },
        required: ['query'],
        additionalProperties: false,
      },
      execute: unsupportedExecute,
    });

    await expect(runAgentRuntime({
      goal: 'Search.',
      model: sequenceModel(['{"type":"tool_call","tool":"search","input":{"query":"a"}}']),
      getTools: () => [unsupportedTool],
    })).rejects.toThrow('unsupported JSON Schema keyword: minLength');
    expect(unsupportedExecute).not.toHaveBeenCalled();

    const typedAdditionalExecute = vi.fn();
    const typedAdditionalTool = tool({
      name: 'tag_trip',
      inputSchema: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
      execute: typedAdditionalExecute,
    });
    await expect(runAgentRuntime({
      goal: 'Tag the trip.',
      model: sequenceModel(['{"type":"tool_call","tool":"tag_trip","input":{"priority":3}}']),
      getTools: () => [typedAdditionalTool],
    })).rejects.toThrow('input.priority must be string');
    expect(typedAdditionalExecute).not.toHaveBeenCalled();
  });

  it('pauses write-capable tools when no visible approval handler exists', async () => {
    const execute = vi.fn();
    const writeTool = tool({
      name: 'add_itinerary_item',
      annotations: { readOnlyHint: false },
      execute,
    });
    const result = await runAgentRuntime({
      goal: 'Stage one itinerary item.',
      model: sequenceModel(['{"type":"tool_call","tool":"add_itinerary_item","input":{}}']),
      getTools: () => [writeTool],
    });

    expect(result.status).toBe('approval_required');
    if (result.status === 'approval_required') {
      expect(result.pendingApproval.tool.name).toBe('add_itinerary_item');
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes an approved write and records a denial without executing', async () => {
    const approvedExecute = vi.fn(() => ({ staged: true }));
    const approvedTool = tool({
      name: 'stage_trip',
      annotations: { readOnlyHint: false },
      execute: approvedExecute,
    });
    const approved = await runAgentRuntime({
      goal: 'Stage the trip.',
      model: sequenceModel([
        '{"type":"tool_call","tool":"stage_trip","input":{}}',
        '{"type":"final","message":"Trip staged for review."}',
      ]),
      getTools: () => [approvedTool],
      approve: () => true,
    });

    expect(approved.status).toBe('completed');
    expect(approvedExecute).toHaveBeenCalledOnce();

    const deniedExecute = vi.fn();
    const deniedTool = tool({
      name: 'book_trip',
      annotations: { readOnlyHint: false },
      execute: deniedExecute,
    });
    const denied = await runAgentRuntime({
      goal: 'Do not book anything.',
      model: sequenceModel(['{"type":"tool_call","tool":"book_trip","input":{}}']),
      getTools: () => [deniedTool],
      approve: () => false,
    });

    expect(denied.status).toBe('denied');
    expect(deniedExecute).not.toHaveBeenCalled();
  });

  it('stops after an ambiguous write failure instead of retrying the side effect', async () => {
    const execute = vi.fn(() => {
      throw new Error('response lost after staging');
    });
    const writeTool = tool({
      name: 'stage_trip',
      annotations: { readOnlyHint: false },
      execute,
    });
    const model = sequenceModel([
      '{"type":"tool_call","tool":"stage_trip","input":{}}',
      '{"type":"tool_call","tool":"stage_trip","input":{}}',
    ]);

    const result = await runAgentRuntime({
      goal: 'Stage the trip once.',
      model,
      getTools: () => [writeTool],
      approve: () => true,
    });

    expect(result.status).toBe('write_failed');
    expect(execute).toHaveBeenCalledOnce();
    expect(model.generate).toHaveBeenCalledOnce();
    expect(result.history).toEqual([
      expect.objectContaining({ ok: false, error: 'response lost after staging' }),
    ]);
  });

  it('keeps a successful write successful when its output is not JSON-compatible', async () => {
    const circularOutput: { staged: boolean; self?: unknown } = { staged: true };
    circularOutput.self = circularOutput;
    const execute = vi.fn(() => circularOutput);
    const writeTool = tool({
      name: 'stage_trip',
      annotations: { readOnlyHint: false },
      execute,
    });

    const result = await runAgentRuntime({
      goal: 'Stage the trip once.',
      model: sequenceModel([
        '{"type":"tool_call","tool":"stage_trip","input":{}}',
        '{"type":"final","message":"Trip staged."}',
      ]),
      getTools: () => [writeTool],
      approve: () => true,
    });

    expect(result.status).toBe('completed');
    expect(execute).toHaveBeenCalledOnce();
    expect(result.history[0]).toMatchObject({
      ok: true,
      output: {
        unavailable: true,
        reason: 'Tool output was not JSON-compatible.',
      },
    });
  });

  it('isolates trace observer failures from approved side effects', async () => {
    const execute = vi.fn(() => ({ staged: true }));
    const writeTool = tool({
      name: 'stage_trip',
      annotations: { readOnlyHint: false },
      execute,
    });

    const result = await runAgentRuntime({
      goal: 'Stage the trip once.',
      model: sequenceModel([
        '{"type":"tool_call","tool":"stage_trip","input":{}}',
        '{"type":"final","message":"Trip staged."}',
      ]),
      getTools: () => [writeTool],
      approve: () => true,
      onEvent: () => {
        throw new Error('trace panel unmounted');
      },
    });

    expect(result.status).toBe('completed');
    expect(execute).toHaveBeenCalledOnce();
    expect(result.events.at(-1)?.type).toBe('completed');
  });

  it('isolates validated input from observer and approval mutations', async () => {
    const execute = vi.fn((input) => ({ staged: input.destination }));
    const writeTool = tool({
      name: 'stage_trip',
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: 'object',
        properties: { destination: { type: 'string' } },
        required: ['destination'],
        additionalProperties: false,
      },
      execute,
    });

    const result = await runAgentRuntime({
      goal: 'Stage Japan.',
      model: sequenceModel([
        '{"type":"tool_call","tool":"stage_trip","input":{"destination":"Japan"}}',
        '{"type":"final","message":"Staged."}',
      ]),
      getTools: () => [writeTool],
      approve: (request) => {
        request.input.destination = 17;
        request.tool.name = 'mutated_tool';
        return true;
      },
      onEvent: (event) => {
        if (event.type === 'tool_call_validated') event.input.destination = 17;
      },
    });

    expect(result.status).toBe('completed');
    expect(execute).toHaveBeenCalledWith({ destination: 'Japan' }, { signal: undefined });
    expect(result.history[0]).toMatchObject({
      tool: 'stage_trip',
      input: { destination: 'Japan' },
    });
  });

  it('returns read-only tool failures to the model and stops at the configured step limit', async () => {
    const failingTool = tool({
      name: 'unstable_search',
      execute: () => {
        throw new Error('inventory unavailable');
      },
    });
    const model = sequenceModel([
      '{"type":"tool_call","tool":"unstable_search","input":{}}',
      '{"type":"tool_call","tool":"unstable_search","input":{}}',
    ]);

    const result = await runAgentRuntime({
      goal: 'Try the lookup safely.',
      model,
      getTools: () => [failingTool],
      maxSteps: 2,
    });

    expect(result.status).toBe('step_limit');
    expect(result.history).toEqual([
      expect.objectContaining({ ok: false, error: 'inventory unavailable' }),
      expect.objectContaining({ ok: false, error: 'inventory unavailable' }),
    ]);
    expect(vi.mocked(model.generate).mock.calls[1][0].prompt).toContain('inventory unavailable');
    expect(result.events.at(-1)?.type).toBe('step_limit_reached');
  });

  it('bounds tool inputs and failure messages before adding them to history', async () => {
    const oversizedExecute = vi.fn();
    const oversizedInput = 'x'.repeat(5_000);
    await expect(runAgentRuntime({
      goal: 'Reject oversized input.',
      model: sequenceModel([JSON.stringify({
        type: 'tool_call',
        tool: 'inspect',
        input: { payload: oversizedInput },
      })]),
      getTools: () => [tool({
        name: 'inspect',
        inputSchema: {
          type: 'object',
          properties: { payload: { type: 'string' } },
          required: ['payload'],
          additionalProperties: false,
        },
        execute: oversizedExecute,
      })],
    })).rejects.toThrow('Tool input exceeded');
    expect(oversizedExecute).not.toHaveBeenCalled();

    const result = await runAgentRuntime({
      goal: 'Bound failures.',
      model: sequenceModel(['{"type":"tool_call","tool":"inspect","input":{}}']),
      getTools: () => [tool({
        name: 'inspect',
        execute: () => {
          throw new Error('x'.repeat(10_000));
        },
      })],
      maxSteps: 1,
    });

    expect(result.status).toBe('step_limit');
    expect(result.history[0].error?.length).toBe(4_000);
    const failureEvent = result.events.find(({ type }) => type === 'tool_failed');
    expect(failureEvent?.type === 'tool_failed' ? failureEvent.error.length : 0).toBe(4_000);
  });

  it('bounds stored tool output before it reaches later model prompts', async () => {
    const model = sequenceModel([
      '{"type":"tool_call","tool":"large_result","input":{}}',
      '{"type":"final","message":"Done"}',
    ]);
    const result = await runAgentRuntime({
      goal: 'Inspect a bounded result.',
      model,
      getTools: () => [tool({
        name: 'large_result',
        execute: () => ({ id: 'result-1', payload: 'x'.repeat(20_000) }),
      })],
    });

    expect(result.status).toBe('completed');
    expect(result.history[0].output).toMatchObject({ truncated: true });
    expect(JSON.stringify(result.history[0].output).length).toBeLessThanOrEqual(4_000);
    expect(vi.mocked(model.generate).mock.calls[1][0].prompt.length).toBeLessThan(6_000);
  });

  it('bounds cumulative prompt history while preserving the most recent steps', () => {
    const inspectTool = tool({ name: 'inspect', execute: () => null });
    const history = Array.from({ length: 20 }, (_, index) => ({
      step: index + 1,
      tool: 'inspect',
      input: { payload: `${index}-`.repeat(600) },
      ok: true,
      output: { result: `${index}-`.repeat(600) },
    }));

    const prompt = buildAgentRuntimePrompt('Inspect bounded history.', [inspectTool], history);
    const historyLine = prompt.split('\n').find((line) => line.startsWith('Tool history:')) ?? '';

    expect(historyLine).toContain('omittedEarlierSteps');
    expect(historyLine).toContain('19-');
    expect(historyLine.length).toBeLessThan(8_100);
  });

  it('rejects malformed, over-broad, and unavailable model decisions', async () => {
    expect(() => parseAgentDecision('not json')).toThrow(AgentRuntimeError);
    expect(() => parseAgentDecision('{"type":"final","message":"ok","extra":true}'))
      .toThrow('unsupported fields');

    await expect(runAgentRuntime({
      goal: 'Use only listed tools.',
      model: sequenceModel(['{"type":"tool_call","tool":"invented_tool","input":{}}']),
      getTools: () => [],
    })).rejects.toThrow('unavailable tool');
  });

  it('cancels before model or tool execution and passes the signal to adapters', async () => {
    const cancelledController = new AbortController();
    cancelledController.abort();
    const cancelledModel = sequenceModel(['{"type":"final","message":"Too late"}']);

    await expect(runAgentRuntime({
      goal: 'Cancel safely.',
      model: cancelledModel,
      getTools: () => [],
      signal: cancelledController.signal,
    })).rejects.toThrow('cancelled');
    expect(cancelledModel.generate).not.toHaveBeenCalled();

    const activeController = new AbortController();
    const execute = vi.fn((_input, context) => ({ aborted: context?.signal?.aborted }));
    const model: RuntimeModel = {
      generate: vi.fn(async (request) => {
        expect(request.signal).toBe(activeController.signal);
        return vi.mocked(model.generate).mock.calls.length === 1
          ? '{"type":"tool_call","tool":"inspect","input":{}}'
          : '{"type":"final","message":"Done"}';
      }),
    };

    const result = await runAgentRuntime({
      goal: 'Inspect safely.',
      model,
      getTools: () => [tool({ name: 'inspect', execute })],
      signal: activeController.signal,
    });

    expect(result.status).toBe('completed');
    expect(execute).toHaveBeenCalledWith({}, { signal: activeController.signal });
  });

  it('rechecks cancellation after tool refresh and tool-start observers', async () => {
    const refreshController = new AbortController();
    const refreshModel = sequenceModel(['{"type":"final","message":"Too late"}']);
    await expect(runAgentRuntime({
      goal: 'Cancel after refresh.',
      model: refreshModel,
      getTools: () => [],
      signal: refreshController.signal,
      onEvent: (event) => {
        if (event.type === 'tools_refreshed') refreshController.abort();
      },
    })).rejects.toThrow('cancelled');
    expect(refreshModel.generate).not.toHaveBeenCalled();

    const startController = new AbortController();
    const execute = vi.fn();
    await expect(runAgentRuntime({
      goal: 'Cancel before execution.',
      model: sequenceModel(['{"type":"tool_call","tool":"stage_trip","input":{}}']),
      getTools: () => [tool({
        name: 'stage_trip',
        annotations: { readOnlyHint: false },
        execute,
      })],
      signal: startController.signal,
      approve: () => true,
      onEvent: (event) => {
        if (event.type === 'tool_started') startController.abort();
      },
    })).rejects.toThrow('cancelled');
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires own properties and rejects non-plain tool schemas', async () => {
    const execute = vi.fn();
    await expect(runAgentRuntime({
      goal: 'Require an own constructor field.',
      model: sequenceModel(['{"type":"tool_call","tool":"inspect","input":{}}']),
      getTools: () => [tool({
        name: 'inspect',
        inputSchema: {
          type: 'object',
          properties: { constructor: { type: 'string' } },
          required: ['constructor'],
          additionalProperties: false,
        },
        execute,
      })],
    })).rejects.toThrow('input.constructor is required');
    expect(execute).not.toHaveBeenCalled();

    const dateSchemaTool = tool({
      name: 'date_schema',
      inputSchema: new Date() as unknown as Record<string, unknown>,
      execute,
    });
    await expect(runAgentRuntime({
      goal: 'Reject non-plain schemas.',
      model: sequenceModel(['{"type":"final","message":"Unsafe"}']),
      getTools: () => [dateSchemaTool],
    })).rejects.toThrow('input schema is invalid');
  });
});
