import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { LLMConfiguration } from '../llm';
import { DEFAULT_LLM_PROFILE_IDS, LLMProfileValidationError, deleteProfile, ensureDefaultProfiles, listProfiles, loadProfile, saveProfile, validateProfile } from '../llm';

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'llm-profiles-'));

describe('LLM profiles', () => {
  it('saves, loads, and lists profiles', () => {
    const dir = makeTempDir();
    try {
      const configA: LLMConfiguration = { provider: 'openai', model: 'gpt-5', apiKeyRef: { kind: 'key', name: 'OPENAI_API_KEY' } };
      const configB: LLMConfiguration = { provider: 'anthropic', model: 'claude', apiKeyRef: { kind: 'key', name: 'ANTHROPIC_API_KEY' } };
      saveProfile('b', configB, { rootDir: dir });
      saveProfile('a', configA, { rootDir: dir });

      expect(listProfiles({ rootDir: dir })).toEqual(['a', 'b']);

      const loaded = loadProfile('a', { rootDir: dir });
      expect(loaded.profileId).toBe('a');
      expect(loaded.config.model).toBe('gpt-5');
      expect(loaded.config.provider).toBe('openai');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits inline apiKeyRef and headers when includeSecrets=false', () => {
    const dir = makeTempDir();
    try {
      saveProfile(
        'no-secrets',
        {
          provider: 'openai',
          model: 'gpt-5',
          apiKeyRef: { kind: 'inline', value: 'sk-secret' },
          headers: { Authorization: 'Bearer sk-secret', 'X-Title': 'not-a-secret' },
        },
        { rootDir: dir },
      );
      const filePath = path.join(dir, 'no-secrets.json');
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;

      expect(payload.apiKeyRef).toBeUndefined();
      expect(payload.headers).toBeUndefined();
      const loaded = loadProfile('no-secrets', { rootDir: dir }).config;
      expect(loaded.apiKeyRef).toBeUndefined();
      expect(loaded.headers).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists inline apiKeyRef when includeSecrets=true', () => {
    const dir = makeTempDir();
    try {
      saveProfile(
        'with-secrets',
        { provider: 'openai', model: 'gpt-5', apiKeyRef: { kind: 'inline', value: 'sk-secret' } },
        { rootDir: dir, includeSecrets: true },
      );
      const filePath = path.join(dir, 'with-secrets.json');
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;

      expect(payload.apiKeyRef).toMatchObject({ kind: 'inline', value: 'sk-secret' });
      if (process.platform !== 'win32') {
        expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates profile payloads', () => {
    expect(() => validateProfile({})).toThrow(LLMProfileValidationError);
    expect(() => validateProfile({ model: '' })).toThrow(LLMProfileValidationError);
    expect(validateProfile({ model: 'gpt-5', provider: 'openai' }).model).toBe('gpt-5');
  });

  it('validates profiles before saving', () => {
    const dir = makeTempDir();
    try {
      expect(() => saveProfile('invalid', { model: '' } as unknown as LLMConfiguration, { rootDir: dir })).toThrow(
        LLMProfileValidationError,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores invalid profile ids when listing files on disk', () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'bad name.json'), '{}', 'utf8');
      saveProfile('good', { model: 'gpt-5' }, { rootDir: dir });
      expect(listProfiles({ rootDir: dir })).toEqual(['good']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid profile ids', () => {
    const dir = makeTempDir();
    try {
      expect(() => saveProfile('../evil', { model: 'gpt-5' }, { rootDir: dir })).toThrow(
        LLMProfileValidationError,
      );
      expect(() => loadProfile('../evil', { rootDir: dir })).toThrow(LLMProfileValidationError);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deletes profiles from disk', () => {
    const dir = makeTempDir();
    try {
      saveProfile('a', { provider: 'openai', model: 'gpt-5' }, { rootDir: dir });
      expect(listProfiles({ rootDir: dir })).toEqual(['a']);

      deleteProfile('a', { rootDir: dir });
      expect(listProfiles({ rootDir: dir })).toEqual([]);
      expect(() => loadProfile('a', { rootDir: dir })).toThrow(LLMProfileValidationError);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seeds canonical default profiles when requested', () => {
    const dir = makeTempDir();
    try {
      expect(listProfiles({ rootDir: dir })).toEqual([]);
      expect(ensureDefaultProfiles({ rootDir: dir })).toEqual([...DEFAULT_LLM_PROFILE_IDS]);
      expect(listProfiles({ rootDir: dir })).toEqual([...DEFAULT_LLM_PROFILE_IDS]);

      for (const id of DEFAULT_LLM_PROFILE_IDS) {
        const loaded = loadProfile(id, { rootDir: dir });
        expect(loaded.profileId).toBe(id);
        expect(typeof loaded.config.model).toBe('string');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
