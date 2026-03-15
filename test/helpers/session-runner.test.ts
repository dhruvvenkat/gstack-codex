import { describe, test, expect } from 'bun:test';
import { parseNDJSON, resolveBunForE2E, resolveCodexExecutable } from './session-runner';

// Fixture: minimal NDJSON session (legacy Claude-style)
const LEGACY_FIXTURE_LINES = [
  '{"type":"system","subtype":"init","session_id":"test-123"}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu1","name":"Bash","input":{"command":"echo hello"}}]}}',
  '{"type":"user","tool_use_result":{"tool_use_id":"tu1","stdout":"hello\\n","stderr":""}}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"The command printed hello."}]}}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"Let me also read a file."},{"type":"tool_use","id":"tu2","name":"Read","input":{"file_path":"/tmp/test"}}]}}',
  '{"type":"result","subtype":"success","total_cost_usd":0.05,"num_turns":3,"usage":{"input_tokens":100,"output_tokens":50},"result":"Done."}',
];

describe('parseNDJSON', () => {
  test('parses valid legacy NDJSON with system + assistant + result events', () => {
    const parsed = parseNDJSON(LEGACY_FIXTURE_LINES);
    expect(parsed.transcript).toHaveLength(6);
    expect(parsed.transcript[0].type).toBe('system');
    expect(parsed.transcript[5].type).toBe('result');
  });

  test('extracts tool calls from legacy assistant.message.content[].type === tool_use', () => {
    const parsed = parseNDJSON(LEGACY_FIXTURE_LINES);
    expect(parsed.toolCalls).toHaveLength(2);
    expect(parsed.toolCalls[0]).toEqual({
      tool: 'Bash',
      input: { command: 'echo hello' },
      output: '',
    });
    expect(parsed.toolCalls[1]).toEqual({
      tool: 'Read',
      input: { file_path: '/tmp/test' },
      output: '',
    });
    expect(parsed.toolCallCount).toBe(2);
  });

  test('parses Codex exec JSONL with command_execution items', () => {
    const lines = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Running a shell command."}}',
      '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"echo ok","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"echo ok","aggregated_output":"ok\\n","exit_code":0,"status":"completed"}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"done"}}',
      '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":2}}',
    ];

    const parsed = parseNDJSON(lines);
    expect(parsed.turnCount).toBe(1);
    expect(parsed.toolCallCount).toBe(1);
    expect(parsed.toolCalls).toEqual([
      {
        tool: 'command_execution',
        input: { command: 'echo ok' },
        output: 'ok\n',
      },
    ]);
    expect(parsed.lastAgentMessage).toBe('done');
    expect(parsed.resultLine?.type).toBe('turn.completed');
  });

  test('skips malformed lines without throwing', () => {
    const lines = [
      '{"type":"system"}',
      'this is not json',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}',
      '{incomplete json',
      '{"type":"result","subtype":"success","result":"done"}',
    ];
    const parsed = parseNDJSON(lines);
    expect(parsed.transcript).toHaveLength(3);
    expect(parsed.resultLine?.subtype).toBe('success');
  });

  test('skips empty and whitespace-only lines', () => {
    const lines = [
      '',
      '  ',
      '{"type":"system"}',
      '\t',
      '{"type":"result","subtype":"success","result":"ok"}',
    ];
    const parsed = parseNDJSON(lines);
    expect(parsed.transcript).toHaveLength(2);
  });

  test('extracts resultLine from result event', () => {
    const parsed = parseNDJSON(LEGACY_FIXTURE_LINES);
    expect(parsed.resultLine).not.toBeNull();
    expect(parsed.resultLine.subtype).toBe('success');
    expect(parsed.resultLine.total_cost_usd).toBe(0.05);
    expect(parsed.resultLine.num_turns).toBe(3);
    expect(parsed.resultLine.result).toBe('Done.');
  });

  test('counts turns correctly for legacy fixture', () => {
    const parsed = parseNDJSON(LEGACY_FIXTURE_LINES);
    expect(parsed.turnCount).toBe(3);
  });

  test('handles empty input', () => {
    const parsed = parseNDJSON([]);
    expect(parsed.transcript).toHaveLength(0);
    expect(parsed.resultLine).toBeNull();
    expect(parsed.turnCount).toBe(0);
    expect(parsed.toolCallCount).toBe(0);
    expect(parsed.toolCalls).toHaveLength(0);
    expect(parsed.lastAgentMessage).toBe('');
  });

  test('handles assistant event with no content array', () => {
    const lines = [
      '{"type":"assistant","message":{}}',
      '{"type":"assistant"}',
    ];
    const parsed = parseNDJSON(lines);
    expect(parsed.turnCount).toBe(2);
    expect(parsed.toolCalls).toHaveLength(0);
  });
});

describe('resolveCodexExecutable', () => {
  test('prefers explicit CODEX_BIN env override', () => {
    expect(resolveCodexExecutable({ CODEX_BIN: '/custom/codex' }, '/home/test')).toBe('/custom/codex');
  });
});

describe('resolveBunForE2E', () => {
  test('prefers explicit BUN_BIN env override', () => {
    expect(resolveBunForE2E({ BUN_BIN: '/custom/bun' }, '/home/test', '/usr/bin/other')).toBe('/custom/bun');
  });

  test('uses current execPath when already running under bun.exe', () => {
    expect(resolveBunForE2E({}, '/home/test', 'C:\\Users\\Owner\\.bun\\bin\\bun.exe')).toBe('C:\\Users\\Owner\\.bun\\bin\\bun.exe');
  });
});
