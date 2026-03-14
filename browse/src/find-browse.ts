/**
 * find-browse — locate the gstack browse binary.
 *
 * Compiled to browse/dist/find-browse (standalone binary, no bun runtime needed).
 * Outputs the absolute path to the browse binary on stdout, or exits 1 if not found.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Binary Discovery ───────────────────────────────────────────

function getGitRoot(): string | null {
  try {
    const proc = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString().trim();
  } catch {
    return null;
  }
}

export interface LocateBinaryOptions {
  env?: Record<string, string | undefined>;
  gitRoot?: string | null;
  homeDir?: string;
  exists?: (path: string) => boolean;
}

function getCodexHome(
  env: Record<string, string | undefined>,
  homeDir: string,
): string {
  return env.CODEX_HOME || join(homeDir, '.codex');
}

export function getBinaryCandidates(options: LocateBinaryOptions = {}): string[] {
  const env = options.env || process.env;
  const root = options.gitRoot === undefined ? getGitRoot() : options.gitRoot;
  const home = options.homeDir || homedir();
  const codexHome = getCodexHome(env, home);
  const candidates: string[] = [];

  if (env.GSTACK_BROWSE_BIN) {
    candidates.push(env.GSTACK_BROWSE_BIN);
  }

  // Workspace-local Codex install takes priority.
  if (root) {
    candidates.push(join(root, '.codex', 'skills', 'gstack', 'browse', 'dist', 'browse'));
  }

  // Global Codex install via CODEX_HOME or ~/.codex.
  candidates.push(join(codexHome, 'skills', 'gstack', 'browse', 'dist', 'browse'));

  // Legacy Claude locations are still supported as a fallback during migration.
  if (root) {
    candidates.push(join(root, '.claude', 'skills', 'gstack', 'browse', 'dist', 'browse'));
  }
  candidates.push(join(home, '.claude', 'skills', 'gstack', 'browse', 'dist', 'browse'));

  return [...new Set(candidates)];
}

export function locateBinary(options: LocateBinaryOptions = {}): string | null {
  const exists = options.exists || existsSync;

  for (const candidate of getBinaryCandidates(options)) {
    if (exists(candidate)) return candidate;
  }

  return null;
}

// ─── Main ───────────────────────────────────────────────────────

function main() {
  const bin = locateBinary();
  if (!bin) {
    process.stderr.write(
      'ERROR: browse binary not found. Run ./setup-codex or set GSTACK_BROWSE_BIN.\n'
    );
    process.exit(1);
  }

  console.log(bin);
}

if (import.meta.main) {
  main();
}
