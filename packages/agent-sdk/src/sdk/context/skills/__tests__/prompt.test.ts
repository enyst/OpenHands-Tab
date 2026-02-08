import { describe, expect, it } from 'vitest';
import { Skill, toPrompt } from '..';

describe('skills.toPrompt', () => {
  it('renders a placeholder when skills is empty', () => {
    expect(toPrompt([])).toBe('<available_skills>\n  no available skills\n</available_skills>');
  });

  it('escapes XML and includes location when source is present', () => {
    const skill = new Skill({
      name: 'a&b',
      content: 'ignored',
      trigger: null,
      description: 'Use <xml> & stuff',
      source: '/path/<skill>',
    });

    const prompt = toPrompt([skill]);
    expect(prompt).toContain('<name>a&amp;b</name>');
    expect(prompt).toContain('<description>Use &lt;xml&gt; &amp; stuff</description>');
    expect(prompt).toContain('<location>/path/&lt;skill&gt;</location>');
  });

  it('falls back to first non-header content line and reports truncated characters', () => {
    const skill = new Skill({
      name: 't',
      content: '#\nX\nY',
      trigger: null,
      source: '/tmp/skill',
    });

    const prompt = toPrompt([skill]);
    expect(prompt).toContain(
      '<description>X... [2 characters truncated. View /tmp/skill for complete information]</description>',
    );
  });

  it('truncates long descriptions and reports truncated characters', () => {
    const skill = new Skill({
      name: 't',
      content: 'ignored',
      trigger: null,
      description: 'ABCDE',
    });

    const prompt = toPrompt([skill], { maxDescriptionLength: 3 });
    expect(prompt).toContain('<description>ABC... [2 characters truncated]</description>');
  });
});

