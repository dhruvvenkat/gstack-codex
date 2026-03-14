/**
 * Tests for find-browse binary locator.
 */

import { describe, test, expect } from 'bun:test';
import { getBinaryCandidates, locateBinary } from '../src/find-browse';

describe('locateBinary', () => {
  test('checks Codex install locations before legacy Claude fallbacks', () => {
    const candidates = getBinaryCandidates({
      env: { CODEX_HOME: '/codex-home' },
      gitRoot: '/repo',
      homeDir: '/home/test',
    });

    expect(candidates).toEqual([
      '/repo/.codex/skills/gstack/browse/dist/browse',
      '/codex-home/skills/gstack/browse/dist/browse',
      '/repo/.claude/skills/gstack/browse/dist/browse',
      '/home/test/.claude/skills/gstack/browse/dist/browse',
    ]);
  });

  test('prefers explicit GSTACK_BROWSE_BIN override', () => {
    const result = locateBinary({
      env: {
        GSTACK_BROWSE_BIN: '/custom/browse',
        CODEX_HOME: '/codex-home',
      },
      gitRoot: '/repo',
      homeDir: '/home/test',
      exists: candidate => candidate === '/custom/browse',
    });

    expect(result).toBe('/custom/browse');
  });

  test('prefers workspace-local Codex install over global Codex install', () => {
    const result = locateBinary({
      env: { CODEX_HOME: '/codex-home' },
      gitRoot: '/repo',
      homeDir: '/home/test',
      exists: candidate =>
        candidate === '/repo/.codex/skills/gstack/browse/dist/browse' ||
        candidate === '/codex-home/skills/gstack/browse/dist/browse',
    });

    expect(result).toBe('/repo/.codex/skills/gstack/browse/dist/browse');
  });

  test('falls back to legacy Claude install paths when Codex install is absent', () => {
    const result = locateBinary({
      env: { CODEX_HOME: '/codex-home' },
      gitRoot: '/repo',
      homeDir: '/home/test',
      exists: candidate => candidate === '/home/test/.claude/skills/gstack/browse/dist/browse',
    });

    expect(result).toBe('/home/test/.claude/skills/gstack/browse/dist/browse');
  });

  test('returns null when no candidate exists', () => {
    const result = locateBinary({
      env: { CODEX_HOME: '/codex-home' },
      gitRoot: '/repo',
      homeDir: '/home/test',
      exists: () => false,
    });

    expect(result).toBeNull();
  });
});
