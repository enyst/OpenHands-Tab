import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LLMProvider } from './types';

export const MODELS_DEV_API_URL = 'https://models.dev/api.json';

type ModelsDevCost = {
  input?: unknown;
  output?: unknown;
};

type ModelsDevModel = {
  cost?: ModelsDevCost;
};

type ModelsDevProvider = {
  models?: Record<string, ModelsDevModel>;
};

type ModelsDevApi = Record<string, ModelsDevProvider>;

export type ModelsDevTokenPricing = {
  inputCostPerToken: number;
  outputCostPerToken: number;
  source: 'models.dev';
};

const MODELS_DEV_CACHE_DIR = path.join(os.homedir(), '.openhands', 'cache');
const MODELS_DEV_CACHE_PATH = path.join(MODELS_DEV_CACHE_DIR, 'models.dev.api.json');
const MODELS_DEV_META_PATH = path.join(MODELS_DEV_CACHE_DIR, 'models.dev.api.meta.json');
const MODELS_DEV_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MODELS_DEV_FETCH_TIMEOUT_MS = 8000;

type ModelsDevCacheMeta = {
  etag?: string;
  fetchedAtMs?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isModelsDevModelMap = (value: unknown): value is Record<string, ModelsDevModel> =>
  isRecord(value);

const asFiniteNumber = (value: unknown): number | null => {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(num) ? num : null;
};

const safeReadJsonFile = (filePath: string): unknown => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const safeWriteJsonFile = (filePath: string, value: unknown): void => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
  } catch {
    // Best-effort cache: ignore write errors.
  }
};

const loadCachedApi = (): ModelsDevApi | null => {
  const raw = safeReadJsonFile(MODELS_DEV_CACHE_PATH);
  return isRecord(raw) ? (raw as unknown as ModelsDevApi) : null;
};

const loadCacheMeta = (): ModelsDevCacheMeta | null => {
  const raw = safeReadJsonFile(MODELS_DEV_META_PATH);
  if (!isRecord(raw)) return null;
  const etag = typeof raw.etag === 'string' ? raw.etag : undefined;
  const fetchedAtMs = asFiniteNumber(raw.fetchedAtMs);
  return { etag, fetchedAtMs: fetchedAtMs === null ? undefined : fetchedAtMs };
};

const isCacheFresh = (meta: ModelsDevCacheMeta | null): boolean => {
  if (!meta?.fetchedAtMs) return false;
  return Date.now() - meta.fetchedAtMs < MODELS_DEV_CACHE_TTL_MS;
};

// De-dupe concurrent refreshes, but do not permanently memoize results in memory.
// We want disk TTL + ETag logic to remain effective even for long-running sessions.
let inflightFetch: Promise<ModelsDevApi> | null = null;

export const getModelsDevProviderId = (provider: LLMProvider): string | null => {
  switch (provider) {
    case 'openai':
      return 'openai';
    case 'anthropic':
      return 'anthropic';
    case 'gemini':
      return 'google';
    case 'openrouter':
      return 'openrouter';
    case 'litellm_proxy':
      return null;
    default:
      return null;
  }
};

export const extractModelsDevTokenPricing = (params: {
  api: ModelsDevApi;
  providerId: string;
  modelId: string;
}): ModelsDevTokenPricing | null => {
  const { api, providerId, modelId } = params;
  const provider = api[providerId];
  const models = provider?.models;
  if (!models || !isModelsDevModelMap(models)) return null;

  const direct = models[modelId];
  const model = (() => {
    if (direct) return direct;
    const target = modelId.toLowerCase();
    const entry = Object.entries(models).find(([key]) => key.toLowerCase() === target);
    return entry ? entry[1] : undefined;
  })();
  if (!model) return null;

  const costRaw = model.cost;
  if (!costRaw || !isRecord(costRaw)) return null;

  // models.dev cost fields are USD per 1M tokens.
  const inputPerMillion = asFiniteNumber(costRaw.input);
  const outputPerMillion = asFiniteNumber(costRaw.output);
  if (inputPerMillion === null || outputPerMillion === null) return null;
  if (inputPerMillion <= 0 || outputPerMillion <= 0) return null;

  return {
    inputCostPerToken: inputPerMillion / 1_000_000,
    outputCostPerToken: outputPerMillion / 1_000_000,
    source: 'models.dev',
  };
};

export const getModelsDevApi = async (): Promise<ModelsDevApi> => {
  const meta = loadCacheMeta();
  const cached = loadCachedApi();
  if (cached && isCacheFresh(meta)) return cached;

  if (inflightFetch) return inflightFetch;

  inflightFetch = (async () => {
    const headers: Record<string, string> = {};
    if (meta?.etag) headers['If-None-Match'] = meta.etag;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODELS_DEV_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(MODELS_DEV_API_URL, { headers, signal: controller.signal });
      if (response.status === 304 && cached) {
        safeWriteJsonFile(MODELS_DEV_META_PATH, { ...meta, fetchedAtMs: Date.now() });
        return cached;
      }
      if (!response.ok) {
        return cached ?? {};
      }

      const json = (await response.json()) as unknown;
      if (!isRecord(json)) return cached ?? {};

      safeWriteJsonFile(MODELS_DEV_CACHE_PATH, json);
      safeWriteJsonFile(MODELS_DEV_META_PATH, {
        etag: response.headers.get('etag') ?? undefined,
        fetchedAtMs: Date.now(),
      });

      return json as unknown as ModelsDevApi;
    } catch {
      return cached ?? {};
    } finally {
      clearTimeout(timer);
      inflightFetch = null;
    }
  })();

  return inflightFetch;
};

export const lookupModelsDevTokenPricing = async (params: {
  provider: LLMProvider;
  model: string;
}): Promise<ModelsDevTokenPricing | null> => {
  const providerId = getModelsDevProviderId(params.provider);
  if (!providerId) return null;
  const modelId = params.model.trim();
  if (!modelId) return null;

  const api = await getModelsDevApi();
  return extractModelsDevTokenPricing({ api, providerId, modelId });
};
