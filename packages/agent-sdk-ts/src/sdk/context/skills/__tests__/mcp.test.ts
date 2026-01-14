import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findMcpConfig, loadMcpConfig, validateMcpConfigObject } from '../mcp';
import { SkillValidationError } from '../exceptions';

describe('MCP config', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('findMcpConfig', () => {
    it('returns path when .mcp.json exists', () => {
      const mcpPath = path.join(tempDir, '.mcp.json');
      fs.writeFileSync(mcpPath, '{}');

      const result = findMcpConfig(tempDir);
      expect(result).toBe(mcpPath);
    });

    it('returns null when .mcp.json does not exist', () => {
      const result = findMcpConfig(tempDir);
      expect(result).toBe(null);
    });

    it('returns null when .mcp.json is a directory', () => {
      const mcpPath = path.join(tempDir, '.mcp.json');
      fs.mkdirSync(mcpPath);

      const result = findMcpConfig(tempDir);
      expect(result).toBe(null);
    });
  });

  describe('validateMcpConfigObject', () => {
    it('validates correct config with command', () => {
      const config = {
        mcpServers: {
          testServer: {
            command: 'node',
            args: ['server.js'],
          },
        },
      };

      const result = validateMcpConfigObject(config);
      expect(result.mcpServers.testServer.command).toBe('node');
      expect(result.mcpServers.testServer.args).toEqual(['server.js']);
    });

    it('validates config with url (http server)', () => {
      const config = {
        mcpServers: {
          httpServer: {
            url: 'http://localhost:8080',
            headers: { 'Authorization': 'Bearer token' },
          },
        },
      };

      const result = validateMcpConfigObject(config);
      expect(result.mcpServers.httpServer.url).toBe('http://localhost:8080');
      expect(result.mcpServers.httpServer.headers).toEqual({ 'Authorization': 'Bearer token' });
    });

    it('validates config with type and cwd', () => {
      const config = {
        mcpServers: {
          myServer: {
            type: 'stdio',
            command: 'python',
            args: ['server.py'],
            cwd: '/path/to/dir',
          },
        },
      };

      const result = validateMcpConfigObject(config);
      expect(result.mcpServers.myServer.type).toBe('stdio');
      expect(result.mcpServers.myServer.cwd).toBe('/path/to/dir');
    });

    it('validates config with env', () => {
      const config = {
        mcpServers: {
          myServer: {
            command: 'python',
            env: { 'MY_VAR': 'value' },
          },
        },
      };

      const result = validateMcpConfigObject(config);
      expect(result.mcpServers.myServer.env).toEqual({ 'MY_VAR': 'value' });
    });

    it('throws for non-object config', () => {
      expect(() => validateMcpConfigObject(null)).toThrow(SkillValidationError);
      expect(() => validateMcpConfigObject('string')).toThrow(SkillValidationError);
      expect(() => validateMcpConfigObject([])).toThrow(SkillValidationError);
    });

    it('throws for missing mcpServers key', () => {
      const config = { otherKey: {} };
      expect(() => validateMcpConfigObject(config)).toThrow(SkillValidationError);
      expect(() => validateMcpConfigObject(config)).toThrow("missing required key 'mcpServers'");
    });

    it('throws when mcpServers is not an object', () => {
      const config = { mcpServers: 'not-an-object' };
      expect(() => validateMcpConfigObject(config)).toThrow(SkillValidationError);
      expect(() => validateMcpConfigObject(config)).toThrow("'mcpServers' must be an object");
    });

    it('throws for server missing both command and url', () => {
      const config = {
        mcpServers: {
          badServer: { args: ['test'] },
        },
      };
      expect(() => validateMcpConfigObject(config)).toThrow(SkillValidationError);
      expect(() => validateMcpConfigObject(config)).toThrow("expected 'command' (stdio) or 'url' (http/sse)");
    });

    it('throws when args is not a string array', () => {
      const config = {
        mcpServers: {
          badServer: {
            command: 'node',
            args: [1, 2, 3],
          },
        },
      };
      expect(() => validateMcpConfigObject(config)).toThrow(SkillValidationError);
      expect(() => validateMcpConfigObject(config)).toThrow("'args' must be a string[]");
    });

    it('throws when env is not a string record', () => {
      const config = {
        mcpServers: {
          badServer: {
            command: 'node',
            env: { key: 123 },
          },
        },
      };
      expect(() => validateMcpConfigObject(config)).toThrow(SkillValidationError);
      expect(() => validateMcpConfigObject(config)).toThrow("'env' must be a record<string,string>");
    });

    it('throws when headers is not a string record', () => {
      const config = {
        mcpServers: {
          badServer: {
            url: 'http://localhost',
            headers: { key: 123 },
          },
        },
      };
      expect(() => validateMcpConfigObject(config)).toThrow(SkillValidationError);
      expect(() => validateMcpConfigObject(config)).toThrow("'headers' must be a record<string,string>");
    });

    it('throws when cwd is not a string', () => {
      const config = {
        mcpServers: {
          badServer: {
            command: 'node',
            cwd: 123,
          },
        },
      };
      expect(() => validateMcpConfigObject(config)).toThrow(SkillValidationError);
      expect(() => validateMcpConfigObject(config)).toThrow("'cwd' must be a string");
    });

    it('throws for empty server name', () => {
      const config = {
        mcpServers: {
          '': { command: 'node' },
        },
      };
      expect(() => validateMcpConfigObject(config)).toThrow(SkillValidationError);
      expect(() => validateMcpConfigObject(config)).toThrow('contains an empty key');
    });

    it('throws for whitespace-only server name', () => {
      const config = {
        mcpServers: {
          '   ': { command: 'node' },
        },
      };
      expect(() => validateMcpConfigObject(config)).toThrow(SkillValidationError);
      expect(() => validateMcpConfigObject(config)).toThrow('contains an empty key');
    });
  });

  describe('loadMcpConfig', () => {
    it('loads and parses a valid .mcp.json file', () => {
      const mcpPath = path.join(tempDir, '.mcp.json');
      const config = {
        mcpServers: {
          testServer: {
            command: 'node',
            args: ['server.js'],
          },
        },
      };
      fs.writeFileSync(mcpPath, JSON.stringify(config));

      const result = loadMcpConfig(mcpPath);
      expect(result.mcpServers.testServer.command).toBe('node');
    });

    it('throws for invalid JSON', () => {
      const mcpPath = path.join(tempDir, '.mcp.json');
      fs.writeFileSync(mcpPath, '{invalid json}');

      expect(() => loadMcpConfig(mcpPath)).toThrow(SkillValidationError);
      expect(() => loadMcpConfig(mcpPath)).toThrow('Invalid JSON');
    });

    it('expands ${SKILL_ROOT} variable when skillRoot is provided', () => {
      const mcpPath = path.join(tempDir, '.mcp.json');
      const config = {
        mcpServers: {
          testServer: {
            command: 'node',
            cwd: '${SKILL_ROOT}/scripts',
          },
        },
      };
      fs.writeFileSync(mcpPath, JSON.stringify(config));

      const result = loadMcpConfig(mcpPath, { skillRoot: tempDir });
      expect(result.mcpServers.testServer.cwd).toBe(`${tempDir}/scripts`);
    });

    it('expands environment variables', () => {
      const mcpPath = path.join(tempDir, '.mcp.json');
      const testValue = 'test-value-' + Date.now();
      process.env.MCP_TEST_VAR = testValue;

      const config = {
        mcpServers: {
          testServer: {
            command: '${MCP_TEST_VAR}',
          },
        },
      };
      fs.writeFileSync(mcpPath, JSON.stringify(config));

      const result = loadMcpConfig(mcpPath);
      expect(result.mcpServers.testServer.command).toBe(testValue);

      delete process.env.MCP_TEST_VAR;
    });

    it('uses default value when variable is undefined', () => {
      const mcpPath = path.join(tempDir, '.mcp.json');
      const config = {
        mcpServers: {
          testServer: {
            command: '${UNDEFINED_VAR:-default_command}',
          },
        },
      };
      fs.writeFileSync(mcpPath, JSON.stringify(config));

      const result = loadMcpConfig(mcpPath);
      expect(result.mcpServers.testServer.command).toBe('default_command');
    });

    it('keeps undefined variable placeholder when no default', () => {
      const mcpPath = path.join(tempDir, '.mcp.json');
      const config = {
        mcpServers: {
          testServer: {
            command: '${DEFINITELY_UNDEFINED_VAR_12345}',
          },
        },
      };
      fs.writeFileSync(mcpPath, JSON.stringify(config));

      const result = loadMcpConfig(mcpPath);
      expect(result.mcpServers.testServer.command).toBe('${DEFINITELY_UNDEFINED_VAR_12345}');
    });
  });
});
