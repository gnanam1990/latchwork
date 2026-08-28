import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeLocalModelError,
  LOCAL_MODEL_CACHE_BACKEND,
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
});
