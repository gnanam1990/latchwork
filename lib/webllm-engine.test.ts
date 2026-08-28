import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserLocalModel,
  describeLocalModelError,
  isRetryableIndexedDbLoadError,
  LOCAL_MODEL_CACHE_BACKEND,
  retryTransientModelLoad,
  supportsWebGpu,
} from './webllm-engine';

const webLlmMocks = vi.hoisted(() => ({
  createEngine: vi.fn(),
  prebuiltAppConfig: { model_list: [] },
}));

vi.mock('@mlc-ai/web-llm', () => ({
  CreateWebWorkerMLCEngine: webLlmMocks.createEngine,
  prebuiltAppConfig: webLlmMocks.prebuiltAppConfig,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function installModelLoadEnvironment() {
  const workers: Array<{ terminate: ReturnType<typeof vi.fn> }> = [];
  class FakeWorker {
    terminate = vi.fn();

    constructor() {
      workers.push(this);
    }
  }

  vi.stubGlobal('navigator', {
    gpu: { requestAdapter: vi.fn(async () => ({ features: new Set() })) },
  });
  vi.stubGlobal('Worker', FakeWorker);
  return workers;
}

function createReadyEngine() {
  return {
    chat: { completions: { create: vi.fn() } },
    unload: vi.fn(async () => undefined),
  };
}

describe('WebLLM capability detection', () => {
  it('rejects a browser that exposes WebGPU without a usable adapter', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn(async () => null) },
    });

    await expect(supportsWebGpu()).resolves.toBe(false);
  });

  it('accepts WebGPU only after an adapter is available', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn(async () => ({ features: new Set() })) },
    });

    await expect(supportsWebGpu()).resolves.toBe(true);
  });

  it('fails closed when adapter discovery throws', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn(async () => { throw new Error('blocked'); }) },
    });

    await expect(supportsWebGpu()).resolves.toBe(false);
  });
});

describe('WebLLM error reporting', () => {
  it('preserves errors serialized across a worker boundary', () => {
    expect(describeLocalModelError({ message: 'WebGPU device was lost' })).toBe('WebGPU device was lost');
    expect(describeLocalModelError('Worker initialization failed')).toBe('Worker initialization failed');
    expect(describeLocalModelError({ code: 'unknown' })).toBe('Local model failed to load.');
  });
});

describe('WebLLM storage policy', () => {
  it('uses the IndexedDB backend that accepts cross-origin model responses', () => {
    expect(LOCAL_MODEL_CACHE_BACKEND).toBe('indexeddb');
  });

  it('retries only a transient IndexedDB connection-close failure', () => {
    expect(isRetryableIndexedDbLoadError({
      message: "InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.",
    })).toBe(true);
    expect(isRetryableIndexedDbLoadError(
      new Error('InvalidStateError: IndexedDB transaction is not active'),
    )).toBe(false);
    expect(isRetryableIndexedDbLoadError(new Error('QuotaExceededError: storage is full'))).toBe(false);
    expect(isRetryableIndexedDbLoadError(new Error("NetworkError: Cache.add() encountered a network error"))).toBe(false);
    expect(isRetryableIndexedDbLoadError(new Error('WebGPU device was lost'))).toBe(false);
  });

  it('retries once and returns the resumed load result', async () => {
    const transient = {
      message: "InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.",
    };
    const load = vi.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce('ready');
    const onRetry = vi.fn();

    await expect(retryTransientModelLoad(load, onRetry)).resolves.toBe('ready');
    expect(load).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith(transient);
  });

  it('does not retry permanent failures or retry a second transient failure', async () => {
    const permanent = new Error('QuotaExceededError: storage is full');
    const permanentLoad = vi.fn().mockRejectedValue(permanent);
    await expect(retryTransientModelLoad(permanentLoad, vi.fn())).rejects.toBe(permanent);
    expect(permanentLoad).toHaveBeenCalledOnce();

    const first = { message: "InvalidStateError on IDBDatabase: connection is closing" };
    const second = { message: "InvalidStateError on IDBDatabase: connection is closed" };
    const retryingLoad = vi.fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second);
    await expect(retryTransientModelLoad(retryingLoad, vi.fn())).rejects.toBe(second);
    expect(retryingLoad).toHaveBeenCalledTimes(2);
  });

  it('retries with a fresh worker and terminates every worker it no longer owns', async () => {
    const workers = installModelLoadEnvironment();
    const engine = createReadyEngine();
    const transient = "InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.";
    webLlmMocks.createEngine
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(engine);
    const onProgress = vi.fn();

    const model = await createBrowserLocalModel(onProgress);

    expect(webLlmMocks.createEngine).toHaveBeenCalledTimes(2);
    expect(workers).toHaveLength(2);
    expect(webLlmMocks.createEngine.mock.calls[0]?.[0]).toBe(workers[0]);
    expect(webLlmMocks.createEngine.mock.calls[1]?.[0]).toBe(workers[1]);
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    expect(workers[1]?.terminate).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'retrying',
      text: expect.stringContaining('retrying once'),
    }));

    await model.dispose?.();
    expect(engine.unload).toHaveBeenCalledOnce();
    expect(workers[1]?.terminate).toHaveBeenCalledOnce();
  });

  it('preserves finite progress after an invalid progress report', async () => {
    installModelLoadEnvironment();
    const engine = createReadyEngine();
    webLlmMocks.createEngine.mockImplementationOnce(async (
      _worker: unknown,
      _model: unknown,
      config: {
        initProgressCallback(report: { progress: number; text: string }): void;
      },
    ) => {
      config.initProgressCallback({ progress: Number.NaN, text: 'Invalid progress' });
      config.initProgressCallback({ progress: 0.5, text: 'Valid progress' });
      return engine;
    });
    const onProgress = vi.fn();

    const model = await createBrowserLocalModel(onProgress);

    expect(onProgress.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      progress: 0.5,
      text: 'Valid progress',
    }));
    await model.dispose?.();
  });

  it('terminates one worker without retrying a permanent load failure', async () => {
    const workers = installModelLoadEnvironment();
    const permanent = new Error('QuotaExceededError: storage is full');
    webLlmMocks.createEngine.mockRejectedValueOnce(permanent);
    const onProgress = vi.fn();

    await expect(createBrowserLocalModel(onProgress)).rejects.toBe(permanent);

    expect(webLlmMocks.createEngine).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    expect(onProgress).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'retrying' }));
  });

  it('terminates both workers when the bounded retry also fails', async () => {
    const workers = installModelLoadEnvironment();
    const first = "InvalidStateError on IDBDatabase: connection is closing";
    const second = "InvalidStateError on IDBDatabase: connection is closed";
    webLlmMocks.createEngine
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second);

    await expect(createBrowserLocalModel(vi.fn())).rejects.toBe(second);

    expect(webLlmMocks.createEngine).toHaveBeenCalledTimes(2);
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    expect(workers[1]?.terminate).toHaveBeenCalledOnce();
  });
});
