import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeLocalModelError,
  isRetryableIndexedDbLoadError,
  LOCAL_MODEL_CACHE_BACKEND,
  retryTransientModelLoad,
  supportsWebGpu,
} from './webllm-engine';

afterEach(() => vi.unstubAllGlobals());

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
});
