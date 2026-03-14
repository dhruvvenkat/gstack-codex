import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');

function readFile(...segments: string[]): string {
  return fs.readFileSync(path.join(ROOT, ...segments), 'utf-8');
}

describe('skill path resolution', () => {
  test('review skill resolves supporting docs through Codex-aware lookup', () => {
    const content = readFile('review', 'SKILL.md');

    expect(content).toContain('_CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"');
    expect(content).toContain('[ -d ".codex/skills/review" ] && _REVIEW_DIR=".codex/skills/review"');
    expect(content).toContain('[ -d "$_CODEX_HOME/skills/review" ] && _REVIEW_DIR="$_CODEX_HOME/skills/review"');
    expect(content).toContain('[ -d "$HOME/.claude/skills/review" ] && _REVIEW_DIR="$HOME/.claude/skills/review"');
    expect(content).toContain('Read ``$_REVIEW_DIR/checklist.md``.');
    expect(content).toContain('Read ``$_REVIEW_DIR/greptile-triage.md``');
    expect(content).not.toContain('Read `.claude/skills/review/checklist.md`');
    expect(content).not.toContain('Read `.claude/skills/review/greptile-triage.md`');
  });

  test('ship skill reuses the same Codex-aware review directory lookup', () => {
    const content = readFile('ship', 'SKILL.md');

    expect(content).toContain('_CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"');
    expect(content).toContain('[ -d ".codex/skills/review" ] && _REVIEW_DIR=".codex/skills/review"');
    expect(content).toContain('[ -d "$_CODEX_HOME/skills/review" ] && _REVIEW_DIR="$_CODEX_HOME/skills/review"');
    expect(content).toContain('[ -d "$HOME/.claude/skills/review" ] && _REVIEW_DIR="$HOME/.claude/skills/review"');
    expect(content).toContain('Read ``$_REVIEW_DIR/checklist.md``.');
    expect(content).toContain('Read ``$_REVIEW_DIR/greptile-triage.md``');
    expect(content).not.toContain('Read `.claude/skills/review/checklist.md`');
    expect(content).not.toContain('Read `.claude/skills/review/greptile-triage.md`');
  });

  test('templates match the generated review-path behavior', () => {
    const reviewTemplate = readFile('review', 'SKILL.md.tmpl');
    const shipTemplate = readFile('ship', 'SKILL.md.tmpl');

    for (const content of [reviewTemplate, shipTemplate]) {
      expect(content).toContain('_CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"');
      expect(content).toContain('[ -d ".codex/skills/review" ] && _REVIEW_DIR=".codex/skills/review"');
      expect(content).toContain('[ -d "$_CODEX_HOME/skills/review" ] && _REVIEW_DIR="$_CODEX_HOME/skills/review"');
      expect(content).toContain('[ -d "$HOME/.claude/skills/review" ] && _REVIEW_DIR="$HOME/.claude/skills/review"');
    }
  });

  test('greptile triage helper prefers Codex browse helper before Claude fallback', () => {
    const content = readFile('review', 'greptile-triage.md');

    expect(content).toContain('CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"');
    expect(content).toContain('"$CODEX_HOME/skills/gstack/browse/bin/remote-slug"');
    expect(content).toContain('~/.claude/skills/gstack/browse/bin/remote-slug');
  });
});
