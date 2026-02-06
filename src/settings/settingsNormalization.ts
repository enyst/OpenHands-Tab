import type { HalMode } from '../shared/halTypes';
import type { SavedServer } from '../shared/settingsTypes';
import { normalizeServerUrl } from '../shared/serverUrls';
import { normalizeNonEmptyString } from '../shared/stringUtils';

export interface NormalizedServerSettings {
  serverUrl: string | undefined;
  servers: SavedServer[];
  changed: boolean;
  warnings: string[];
}

export const isSafeProfileId = (value: string): boolean => {
  if (!value.trim()) return false;
  if (value !== value.trim()) return false;
  if (value.includes('/') || value.includes('\\')) return false;
  return /^[a-zA-Z0-9._-]+$/.test(value);
};

export const sanitizePositiveInteger = (value: number | null | undefined): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const int = Math.trunc(value);
  return int > 0 ? int : undefined;
};

export const normalizeHalMode = (value: unknown, defaultValue: HalMode): HalMode => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  switch (trimmed) {
    case 'bundled':
    case 'tts_only':
    case 'voice_confirm':
      return trimmed;
    default:
      return defaultValue;
  }
};

export const clampUnitInterval = (value: number | null | undefined, defaultValue: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
  return Math.min(1, Math.max(0, value));
};

export const normalizeSavedServers = (value: unknown, defaultValue: SavedServer[]): { servers: SavedServer[]; changed: boolean; dropped: number } => {
  if (!Array.isArray(value)) return { servers: defaultValue, changed: true, dropped: 0 };

  const byUrl = new Map<string, SavedServer>();
  let changed = false;
  let dropped = 0;

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      changed = true;
      dropped += 1;
      continue;
    }

    const candidate = entry as Partial<Record<keyof SavedServer, unknown>>;
    const rawUrl = normalizeNonEmptyString(typeof candidate.url === 'string' ? candidate.url : undefined);
    if (!rawUrl) {
      changed = true;
      dropped += 1;
      continue;
    }

    const normalizedUrl = normalizeServerUrl(rawUrl);
    if (!normalizedUrl.ok) {
      changed = true;
      dropped += 1;
      continue;
    }

    const label = normalizeNonEmptyString(typeof candidate.label === 'string' ? candidate.label : undefined);
    if (normalizedUrl.url !== rawUrl) changed = true;

    const existing = byUrl.get(normalizedUrl.url);
    if (existing) {
      // Deduplicate by canonical URL; preserve an existing label, but upgrade if we encounter one later.
      if (!existing.label && label) {
        byUrl.set(normalizedUrl.url, { ...existing, label });
        changed = true;
      } else {
        changed = true;
      }
      continue;
    }

    byUrl.set(normalizedUrl.url, label ? { url: normalizedUrl.url, label } : { url: normalizedUrl.url });
  }

  return { servers: Array.from(byUrl.values()), changed, dropped };
};

export const normalizeServerSettings = (
  rawServerUrl: string | null | undefined,
  rawServers: unknown,
  defaultServers: SavedServer[],
): NormalizedServerSettings => {
  const warnings: string[] = [];
  const trimmedServerUrl = normalizeNonEmptyString(rawServerUrl ?? undefined);
  let serverUrl: string | undefined;
  let serverUrlChanged = false;

  if (trimmedServerUrl) {
    const normalized = normalizeServerUrl(trimmedServerUrl);
    if (normalized.ok) {
      serverUrl = normalized.url;
      if (serverUrl !== trimmedServerUrl) serverUrlChanged = true;
    } else {
      warnings.push(`Invalid server URL: ${normalized.error}`);
      serverUrlChanged = true;
    }
  }

  const serversResult = normalizeSavedServers(rawServers, defaultServers);
  let servers = serversResult.servers;
  let serversChanged = serversResult.changed;

  if (serversResult.dropped > 0) {
    warnings.push(`Dropped ${serversResult.dropped} invalid saved server entr${serversResult.dropped === 1 ? 'y' : 'ies'}.`);
  }

  // If serverUrl is set, always ensure it appears in the servers list (even if manually configured in settings).
  if (serverUrl && !servers.some((s) => s.url === serverUrl)) {
    servers = [...servers, { url: serverUrl }];
    serversChanged = true;
  }

  return { serverUrl, servers, changed: serverUrlChanged || serversChanged, warnings };
};

export const normalizeOracleProfileId = (
  rawOracleProfileId: unknown,
  explicitValueWasNull: boolean,
): { profileId: string | undefined; warnings: string[] } => {
  const warnings: string[] = [];

  if (explicitValueWasNull) {
    warnings.push('Oracle profile id is null. Clear the setting or set a valid string.');
  }

  const oracleProfileIdRaw = normalizeNonEmptyString(typeof rawOracleProfileId === 'string' ? rawOracleProfileId : undefined);
  const oracleProfileId = oracleProfileIdRaw && isSafeProfileId(oracleProfileIdRaw) ? oracleProfileIdRaw : undefined;
  if (oracleProfileIdRaw && !oracleProfileId) {
    warnings.push(`Invalid oracle LLM profile id: ${oracleProfileIdRaw}`);
  }

  return { profileId: oracleProfileId, warnings };
};
