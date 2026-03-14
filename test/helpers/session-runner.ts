/**
 * Codex CLI subprocess runner for skill E2E testing.
 *
 * Spawns `codex exec` as a completely independent process, pipes the prompt
 * via stdin, streams JSONL output for real-time progress, and scans for browse
 * errors.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const GSTACK_DEV_DIR = path.join(os.homedir(), '.gstack-dev');
const HEARTBEAT_PATH = path.join(GSTACK_DEV_DIR, 'e2e-live.json');

/** Sanitize test name for use as filename: strip leading slashes, replace / with - */
export function sanitizeTestName(name: string): string {
  return name.replace(/^\/+/, '').replace(/\//g, '-');
}

/** Atomic write: write to .tmp then rename. Non-fatal on error. */
function atomicWriteSync(filePath: string, data: string): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

export interface CostEstimate {
  inputChars: number;
  outputChars: number;
  estimatedTokens: number;
  estimatedCost: number;
  turnsUsed: number;
}

export interface SkillTestResult {
  toolCalls: Array<{ tool: string; input: any; output: string }>;
  browseErrors: string[];
  exitReason: string;
  duration: number;
  output: string;
  costEstimate: CostEstimate;
  transcript: any[];
}

const BROWSE_ERROR_PATTERNS = [
  /Unknown command: \w+/,
  /Unknown snapshot flag: .+/,
  /ERROR: browse binary not found/,
  /Server failed to start/,
  /no such file or directory.*browse/i,
];

export interface ParsedNDJSON {
  transcript: any[];
  resultLine: any | null;
  turnCount: number;
  toolCallCount: number;
  toolCalls: Array<{ tool: string; input: any; output: string }>;
  lastAgentMessage: string;
}

function getCodexToolInput(item: any): any {
  if (!item || typeof item !== 'object') return {};

  if (item.type === 'command_execution') {
    return { command: item.command || '' };
  }

  const fallback: Record<string, unknown> = {};
  for (const key of ['command', 'path', 'prompt', 'args', 'input']) {
    if (item[key] !== undefined) fallback[key] = item[key];
  }
  return fallback;
}

function getCodexToolOutput(item: any): string {
  if (!item || typeof item !== 'object') return '';
  if (typeof item.aggregated_output === 'string') return item.aggregated_output;
  if (typeof item.output === 'string') return item.output;
  return '';
}

/**
 * Parse JSONL transcript data into a common structure.
 * Supports both legacy Claude-style NDJSON fixtures and Codex exec JSONL.
 */
export function parseNDJSON(lines: string[]): ParsedNDJSON {
  const transcript: any[] = [];
  let resultLine: any = null;
  let turnCount = 0;
  let toolCallCount = 0;
  const toolCalls: ParsedNDJSON['toolCalls'] = [];
  let lastAgentMessage = '';
  const pendingCodexToolCalls = new Map<string, number>();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      transcript.push(event);

      // Legacy Claude-style events.
      if (event.type === 'assistant') {
        turnCount++;
        const content = event.message?.content || [];
        for (const item of content) {
          if (item.type === 'tool_use') {
            toolCallCount++;
            toolCalls.push({
              tool: item.name || 'unknown',
              input: item.input || {},
              output: '',
            });
          }
          if (item.type === 'text' && typeof item.text === 'string') {
            lastAgentMessage = item.text;
          }
        }
      }

      if (event.type === 'result') {
        resultLine = event;
      }

      // Codex exec events.
      if (event.type === 'turn.started') {
        turnCount++;
      }

      if (event.type === 'item.completed' || event.type === 'item.started') {
        const item = event.item || {};

        if (item.type === 'agent_message' && typeof item.text === 'string') {
          lastAgentMessage = item.text;
        }

        if (item.type && item.type !== 'agent_message') {
          if (event.type === 'item.started') {
            toolCallCount++;
            toolCalls.push({
              tool: item.type,
              input: getCodexToolInput(item),
              output: '',
            });
            pendingCodexToolCalls.set(item.id || `idx-${toolCalls.length - 1}`, toolCalls.length - 1);
          } else {
            const pendingIndex = pendingCodexToolCalls.get(item.id || '');
            if (pendingIndex !== undefined) {
              toolCalls[pendingIndex].output = getCodexToolOutput(item);
            } else {
              toolCallCount++;
              toolCalls.push({
                tool: item.type,
                input: getCodexToolInput(item),
                output: getCodexToolOutput(item),
              });
            }
          }
        }
      }

      if (event.type === 'turn.completed') {
        resultLine = event;
      }
    } catch {
      // Skip malformed lines.
    }
  }

  return { transcript, resultLine, turnCount, toolCallCount, toolCalls, lastAgentMessage };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

export function resolveCodexExecutable(
  env: Record<string, string | undefined> = process.env,
  homeDir: string = os.homedir(),
): string {
  if (env.CODEX_BIN) {
    return env.CODEX_BIN;
  }

  const candidates = process.platform === 'win32'
    ? [
        path.join(homeDir, '.codex', '.sandbox-bin', 'codex.exe'),
        path.join(homeDir, 'AppData', 'Roaming', 'npm', 'codex.cmd'),
        'codex',
      ]
    : [
        path.join(homeDir, '.codex', '.sandbox-bin', 'codex'),
        'codex',
      ];

  for (const candidate of candidates) {
    if (candidate === 'codex' || fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'codex';
}

export async function runSkillTest(options: {
  prompt: string;
  workingDirectory: string;
  maxTurns?: number;
  allowedTools?: string[];
  timeout?: number;
  testName?: string;
  runId?: string;
}): Promise<SkillTestResult> {
  const {
    prompt,
    workingDirectory,
    maxTurns = 15,
    timeout = 120_000,
    testName,
    runId,
  } = options;

  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  let runDir: string | null = null;
  const safeName = testName ? sanitizeTestName(testName) : null;

  if (runId) {
    try {
      runDir = path.join(GSTACK_DEV_DIR, 'e2e-runs', runId);
      fs.mkdirSync(runDir, { recursive: true });
    } catch {
      // Non-fatal.
    }
  }

  const lastMessageFile = path.join(
    runDir || path.join(workingDirectory, '.gstack'),
    `${safeName || 'last-message'}.txt`,
  );
  try {
    fs.mkdirSync(path.dirname(lastMessageFile), { recursive: true });
  } catch {
    // Non-fatal.
  }

  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    '-C', workingDirectory,
    '-o', lastMessageFile,
    '-',
  ];

  const proc = Bun.spawn([resolveCodexExecutable(), ...args], {
    cwd: workingDirectory,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  proc.stdin.write(prompt);
  proc.stdin.end();

  let stderr = '';
  let exitReason = 'unknown';
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeout);

  const collectedLines: string[] = [];
  let liveTurnCount = 0;
  let liveToolCount = 0;
  const stderrPromise = new Response(proc.stderr).text();

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        collectedLines.push(line);

        try {
          const event = JSON.parse(line);

          if (event.type === 'turn.started') {
            liveTurnCount++;
          }

          if (event.type === 'item.started') {
            const item = event.item || {};
            if (item.type && item.type !== 'agent_message') {
              liveToolCount++;
              const elapsed = Math.round((Date.now() - startTime) / 1000);
              const toolName = item.type;
              const toolInput = getCodexToolInput(item);
              const progressLine = `  [${elapsed}s] turn ${liveTurnCount} tool #${liveToolCount}: ${toolName}(${truncate(JSON.stringify(toolInput), 80)})\n`;
              process.stderr.write(progressLine);

              if (runDir) {
                try {
                  fs.appendFileSync(path.join(runDir, 'progress.log'), progressLine);
                } catch {
                  // Non-fatal.
                }
              }

              if (runId && testName) {
                try {
                  const toolDesc = `${toolName}(${truncate(JSON.stringify(toolInput), 60)})`;
                  atomicWriteSync(HEARTBEAT_PATH, JSON.stringify({
                    runId,
                    pid: proc.pid,
                    startedAt,
                    currentTest: testName,
                    status: 'running',
                    turn: liveTurnCount,
                    toolCount: liveToolCount,
                    lastTool: toolDesc,
                    lastToolAt: new Date().toISOString(),
                    elapsedSec: elapsed,
                  }, null, 2) + '\n');
                } catch {
                  // Non-fatal.
                }
              }
            }
          }
        } catch {
          // Skip here; parser handles malformed lines later.
        }

        if (runDir && safeName) {
          try {
            fs.appendFileSync(path.join(runDir, `${safeName}.ndjson`), line + '\n');
          } catch {
            // Non-fatal.
          }
        }
      }
    }
  } catch {
    // Stream read error; handled by exit code below.
  }

  if (buf.trim()) {
    collectedLines.push(buf);
  }

  stderr = await stderrPromise;
  const exitCode = await proc.exited;
  clearTimeout(timeoutId);

  if (timedOut) {
    exitReason = 'timeout';
  } else if (exitCode === 0) {
    exitReason = 'success';
  } else {
    exitReason = `exit_code_${exitCode}`;
  }

  const duration = Date.now() - startTime;
  const parsed = parseNDJSON(collectedLines);
  const { transcript, resultLine, toolCalls, lastAgentMessage, turnCount } = parsed;
  const browseErrors: string[] = [];

  const allText = transcript.map(e => JSON.stringify(e)).join('\n') + '\n' + stderr;
  for (const pattern of BROWSE_ERROR_PATTERNS) {
    const match = allText.match(pattern);
    if (match) {
      browseErrors.push(match[0].slice(0, 200));
    }
  }

  if (resultLine) {
    if (resultLine.is_error) {
      exitReason = 'error_api';
    } else if (resultLine.subtype === 'success') {
      exitReason = 'success';
    } else if (resultLine.subtype) {
      exitReason = resultLine.subtype;
    } else if (resultLine.type === 'turn.completed' && exitCode === 0) {
      exitReason = 'success';
    }
  }

  if (/max turns|turn limit/i.test(allText)) {
    exitReason = 'error_max_turns';
  }

  const finalOutput = fs.existsSync(lastMessageFile)
    ? fs.readFileSync(lastMessageFile, 'utf-8')
    : lastAgentMessage;

  if (browseErrors.length > 0 || exitReason !== 'success') {
    try {
      const failureDir = runDir || path.join(workingDirectory, '.gstack', 'test-transcripts');
      fs.mkdirSync(failureDir, { recursive: true });
      const failureName = safeName
        ? `${safeName}-failure.json`
        : `e2e-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      fs.writeFileSync(
        path.join(failureDir, failureName),
        JSON.stringify({
          prompt: prompt.slice(0, 500),
          testName: testName || 'unknown',
          exitReason,
          browseErrors,
          duration,
          turnAtTimeout: timedOut ? liveTurnCount : undefined,
          lastToolCall: liveToolCount > 0 ? `tool #${liveToolCount}` : undefined,
          stderr: stderr.slice(0, 2000),
          result: resultLine ? { type: resultLine.type, subtype: resultLine.subtype, result: finalOutput.slice(0, 500) } : null,
        }, null, 2),
      );
    } catch {
      // Non-fatal.
    }
  }

  const usage = resultLine?.usage || {};
  const costEstimate: CostEstimate = {
    inputChars: prompt.length,
    outputChars: finalOutput.length,
    estimatedTokens: (usage.input_tokens || 0)
      + (usage.output_tokens || 0)
      + (usage.cache_read_input_tokens || usage.cached_input_tokens || 0),
    estimatedCost: Math.round(((resultLine?.total_cost_usd || 0) as number) * 100) / 100,
    turnsUsed: turnCount,
  };

  try {
    fs.unlinkSync(lastMessageFile);
  } catch {
    // Non-fatal.
  }

  return { toolCalls, browseErrors, exitReason, duration, output: finalOutput, costEstimate, transcript };
}
