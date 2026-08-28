import { afterEach, describe, expect, it, vi } from 'vitest';
import { supportsWebGpu } from './webllm-engine';

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
