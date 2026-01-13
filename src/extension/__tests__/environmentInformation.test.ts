import { describe, it, expect } from 'vitest';
import { formatEnvironmentInformation } from '../environmentInformation';

describe('formatEnvironmentInformation', () => {
  it('formats active + open editors with workspace basename rules and disambiguation', () => {
    const text = formatEnvironmentInformation({
      workspaceRoot: '/ws',
      activeEditorPath: '/ws/src/foo.ts',
      openEditorPaths: [
        '/ws/src/foo.ts',
        '/ws/test/foo.ts',
        '/outside/bar.ts',
      ],
    });

    expect(text).toContain('<environment information>');
    expect(text).toContain('</environment information>');

    // duplicate basenames inside workspace are disambiguated
    expect(text).toContain('Active editor: foo.ts — src');
    expect(text).toContain('- foo.ts — src');
    expect(text).toContain('- foo.ts — test');

    // outside-workspace paths remain absolute
    expect(text).toContain('- /outside/bar.ts');
  });

  it('prints none when there is no active editor and no open editors', () => {
    const text = formatEnvironmentInformation({
      workspaceRoot: '/ws',
      activeEditorPath: null,
      openEditorPaths: [],
    });
    expect(text).toContain('Active editor: none');
    expect(text).toContain('Open editors:');
    expect(text).toContain('- none');
  });
});

