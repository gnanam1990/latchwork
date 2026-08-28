import type { LocalTextModel } from './local-agent';
import { getLocalAgentDecisionSchema } from './local-agent';

export const DEFAULT_LOCAL_MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
export const LOCAL_MODEL_CACHE_BACKEND = 'indexeddb' as const;

export interface ModelLoadProgress {
  progress: number;
  text: string;
  phase?: 'loading' | 'retrying';
}

export function describeLocalModelError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'Local model failed to load.';
}

export function isRetryableIndexedDbLoadError(error: unknown): boolean {
  const message = describeLocalModelError(error);
  return /invalidstateerror/i.test(message)
    && /(?:indexeddb|idbdatabase)/i.test(message)
    && /connection is (?:closing|closed)/i.test(message);
}

export async function retryTransientModelLoad<T>(
  load: () => Promise<T>,
  onRetry: (error: unknown) => void,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!isRetryableIndexedDbLoadError(error)) throw error;
    onRetry(error);
    return load();
  }
}

export async function supportsWebGpu(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
  const gpu = (navigator as unknown as {
    gpu?: { requestAdapter(): Promise<unknown | null> };
  }).gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

export async function createBrowserLocalModel(
  onProgress: (report: ModelLoadProgress) => void,
): Promise<LocalTextModel> {
  if (!await supportsWebGpu()) throw new Error('WebGPU is unavailable in this browser.');

  const { CreateWebWorkerMLCEngine, prebuiltAppConfig } = await import('@mlc-ai/web-llm');
  let latestProgress = 0;
  const reportProgress = ({ progress, text }: ModelLoadProgress) => {
    latestProgress = Math.max(latestProgress, Math.max(0, Math.min(1, progress)));
    onProgress({ progress: latestProgress, text, phase: 'loading' });
  };

  const createEngine = async () => {
    const worker = new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module' });
    try {
      const engine = await CreateWebWorkerMLCEngine(worker, DEFAULT_LOCAL_MODEL, {
        appConfig: {
          ...prebuiltAppConfig,
          cacheBackend: LOCAL_MODEL_CACHE_BACKEND,
        },
        initProgressCallback: reportProgress,
      });
      return { engine, worker };
    } catch (error) {
      worker.terminate();
      throw error;
    }
  };

  const { engine, worker } = await retryTransientModelLoad(createEngine, () => {
    onProgress({
      progress: latestProgress,
      text: 'Storage interrupted · retrying once from cached progress…',
      phase: 'retrying',
    });
  });

  return {
    async complete(prompt: string): Promise<string> {
      const response = await engine.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 120,
        response_format: {
          type: 'json_object',
          schema: getLocalAgentDecisionSchema(),
        },
      });
      const content = response.choices[0]?.message.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('Local model returned an empty decision.');
      }
      return content;
    },
    async dispose(): Promise<void> {
      try {
        await engine.unload();
      } finally {
        worker.terminate();
      }
    },
  };
}
