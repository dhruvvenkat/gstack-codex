# Windows to Linux Handoff

This file marks the Windows-specific or Windows-motivated browse/E2E work so it can be reviewed on Linux without guessing which changes were exploratory.

## Current status

- The Codex migration work is partly complete and the non-browse E2E path improved.
- The remaining blocker on this Windows machine is the browse runtime.
- The key finding from debugging was:
  - `node + playwright` launches successfully on this machine
  - `bun + playwright` hangs on this machine
  - `browse` server startup depends on `bun + playwright`

So the remaining failure looks like a Windows-specific Bun/Playwright runtime issue, not a general Codex-porting issue.

## Commits to review on Linux

These commits contain Windows-specific or Windows-motivated changes:

- `89069ed` `test: adapt Codex E2E suite preflight and binary detection`
  - includes Windows `browse.exe` detection in the E2E suite
- `f6648a1` `browse: resolve bun for Codex e2e runs`
  - includes `bun.exe` resolution and `BUN_BIN` injection for nested Codex E2E runs

This commit is cross-platform and should not be treated as Windows-only:

- `8e6607d` `test: await async e2e fixture servers`

These older commits are also part of the current Codex E2E path:

- `a824209` `test: port E2E session runner to Codex exec`
- `b0b7ea8` removed hardcoded `.claude` review-path references

## Reverted exploratory Windows runtime changes

I tested these changes locally on Windows, but they are not left active in the code:

- `browse/src/cli.ts`
  - `metaDir.startsWith('/')` -> `path.isAbsolute(metaDir)`
  - `MAX_START_WAIT` `8000` -> `30000`
  - detached server spawn with ignored stdio
  - explicit awaited `stdout` flush helper

These were exploratory attempts to make the Windows browse daemon behave correctly. They did not resolve the root issue and were reverted from the working tree.

## Linux pickup plan

1. Start from the current branch state and rerun the narrow browse E2E slice:
   - `EVALS=1 bun test test/skill-e2e.test.ts -t "browse basic|browse snapshot|/qa quick"`
2. If the browse tests start passing on Linux, the Windows-only blocker is confirmed.
3. Reevaluate whether `89069ed` and `f6648a1` should stay as-is:
   - keep them if they help cross-platform Codex E2E behavior
   - narrow or revert the Windows-only parts if they are unnecessary on Linux/macOS
4. If browse still fails on Linux, the next place to inspect is:
   - `browse/src/cli.ts`
   - `browse/src/server.ts`
   - `browse/src/browser-manager.ts`

## Most useful evidence from the Windows debugging session

- Direct compiled browse command returned only startup text:
  - `browse.exe status` -> `[browse] Starting server...`
- After hardening startup logic experimentally, it still failed:
  - `[browse] Server failed to start within 30s`
- Raw Bun/Playwright launch probe hung for about two minutes and timed out.
- Raw Node/Playwright launch probe succeeded immediately:

```text
launched
closed
```

## Recommendation

On Linux, treat the current remaining browse failure as a fresh environment check rather than assuming the Windows behavior generalizes. The strongest current hypothesis is:

- Linux likely gets past the Windows Bun/Playwright startup hang
- if so, the next real Codex E2E issue will surface underneath

