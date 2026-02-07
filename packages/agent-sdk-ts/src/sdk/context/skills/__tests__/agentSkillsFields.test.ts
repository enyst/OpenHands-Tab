import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Skill, SkillValidationError } from '../skill';

describe('AgentSkills frontmatter fields parity', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skill-fields-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('parses license, compatibility, metadata, and allowed-tools', () => {
    const skillRoot = join(tempDir, 'my-skill');
    mkdirSync(skillRoot, { recursive: true });
    const skillPath = join(skillRoot, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
description: Example skill
license: MIT
compatibility: openhands>=1.0
metadata:
  version: "1.0"
  build: 123
allowed-tools: "A B"
---

Hello.`,
    );

    const skill = Skill.load({ path: skillPath });
    expect(skill.name).toBe('my-skill');
    expect(skill.description).toBe('Example skill');
    expect(skill.license).toBe('MIT');
    expect(skill.compatibility).toBe('openhands>=1.0');
    expect(skill.metadata).toEqual({ version: '1.0', build: '123' });
    expect(skill.allowedTools).toEqual(['A', 'B']);
  });

  it('accepts allowed_tools underscore alias', () => {
    const skillRoot = join(tempDir, 'my-skill');
    mkdirSync(skillRoot, { recursive: true });
    const skillPath = join(skillRoot, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
description: Example skill
allowed_tools:
  - tool_a
  - tool_b
---

Hello.`,
    );

    const skill = Skill.load({ path: skillPath });
    expect(skill.allowedTools).toEqual(['tool_a', 'tool_b']);
  });

  it('validates metadata is a dictionary and stringifies values', () => {
    const skillRoot = join(tempDir, 'my-skill');
    mkdirSync(skillRoot, { recursive: true });
    const skillPath = join(skillRoot, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
description: Example skill
metadata: string
---

Hello.`,
    );

    expect(() => Skill.load({ path: skillPath })).toThrowError(SkillValidationError);
    expect(() => Skill.load({ path: skillPath })).toThrow(/metadata must be a dictionary/);
  });

  it('validates allowed-tools type', () => {
    const skillRoot = join(tempDir, 'my-skill');
    mkdirSync(skillRoot, { recursive: true });
    const skillPath = join(skillRoot, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
description: Example skill
allowed-tools: 123
---

Hello.`,
    );

    expect(() => Skill.load({ path: skillPath })).toThrowError(SkillValidationError);
    expect(() => Skill.load({ path: skillPath })).toThrow(/allowed-tools must be/);
  });

  it('enforces description max length (<= 1024)', () => {
    const ok = 'a'.repeat(1024);
    const bad = 'a'.repeat(1025);

    const skillRoot = join(tempDir, 'my-skill');
    mkdirSync(skillRoot, { recursive: true });
    const okPath = join(skillRoot, 'SKILL.md');
    writeFileSync(
      okPath,
      `---
description: ${ok}
---

Hello.`,
    );
    expect(() => Skill.load({ path: okPath })).not.toThrow();

    const badPath = join(skillRoot, 'SKILL_BAD.md');
    writeFileSync(
      badPath,
      `---
description: ${bad}
---

Hello.`,
    );
    expect(() => Skill.load({ path: badPath })).toThrowError(SkillValidationError);
    expect(() => Skill.load({ path: badPath })).toThrow(/1024 characters/);
  });

  it('validates description length before trimming whitespace', () => {
    const padded = `${'a'.repeat(1024)} `;

    const skillRoot = join(tempDir, 'my-skill');
    mkdirSync(skillRoot, { recursive: true });
    const skillPath = join(skillRoot, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
description: "${padded}"
---

Hello.`,
    );

    expect(() => Skill.load({ path: skillPath })).toThrowError(SkillValidationError);
    expect(() => Skill.load({ path: skillPath })).toThrow(/1024 characters/);
  });

  it('validates description type', () => {
    const skillRoot = join(tempDir, 'my-skill');
    mkdirSync(skillRoot, { recursive: true });
    const skillPath = join(skillRoot, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
description: 123
---

Hello.`,
    );

    expect(() => Skill.load({ path: skillPath })).toThrowError(SkillValidationError);
    expect(() => Skill.load({ path: skillPath })).toThrow(/description must be a string/);
  });
});
