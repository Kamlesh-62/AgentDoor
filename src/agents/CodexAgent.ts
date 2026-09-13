import type { AgentAdapter } from "./AgentAdapter.js";
import type { AgentRunOptions, AgentRunResult } from "../types.js";
import { runCommand } from "../utils/spawn.js";

/**
 * Wraps the `codex exec` CLI in non-interactive JSONL mode (`--json`).
 *
 * Codex has no bare --effort flag (unlike claude); effort is passed as a
 * `-c model_reasoning_effort=<level>` config override. That key name is
 * this adapter's one assumption about codex's config schema - if a future
 * codex version renames it, this is the only place that needs to change.
 *
 * `--skip-git-repo-check` is passed because codex normally refuses to run
 * outside a git repository, and this router should work from any cwd.
 */
export class CodexAgent implements AgentAdapter {
  readonly name = "codex" as const;

  constructor(private readonly binary: string = "codex") {}

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const args = ["exec"];

    if (options.resumeSessionId) {
      args.push("resume", options.resumeSessionId, options.prompt);
    } else {
      args.push(options.prompt);
    }

    args.push("--json", "--skip-git-repo-check");
    if (options.model) args.push("--model", options.model);
    if (options.effort) args.push("-c", `model_reasoning_effort=${options.effort}`);
    // No human available to approve command/file-edit prompts headlessly -
    // read-only (default true) keeps codex from writing or running
    // anything outside its own sandboxed read access.
    args.push("--sandbox", options.readOnly !== false ? "read-only" : "workspace-write");

    const { stdout, stderr, exitCode } = await runCommand(this.binary, args, {
      cwd: options.cwd,
      signal: options.signal,
      onStdoutLine: (line) => {
        const message = describeCodexEvent(line);
        if (message) options.onEvent?.(message);
      },
    });

    if (exitCode !== 0) {
      throw new Error(
        `codex exited with code ${exitCode}: ${extractCodexError(stdout, stderr)}`,
      );
    }

    return parseCodexJsonl(stdout);
  }
}

/** Turns one raw JSONL line into a short progress message, or null to
 * suppress it. agent_message is intentionally suppressed here since it's
 * the final answer text, shown once via the completed result instead of
 * duplicated during streaming. Unknown item types get a generic
 * best-effort summary rather than being silently dropped, since codex's
 * item.type set isn't something this adapter exhaustively enumerates. */
function describeCodexEvent(line: string): string | null {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  switch (event.type) {
    case "thread.started":
      return "session started";
    case "turn.started":
      return "turn started";
    case "item.started":
    case "item.updated":
    case "item.completed": {
      const item = event.item;
      if (!item || item.type === "agent_message") return null;
      const detail = item.command ?? item.path ?? item.cmd ?? "";
      return `${item.type}${detail ? `: ${detail}` : ""}`;
    }
    default:
      return null;
  }
}

/**
 * On failure, the useful message is usually a JSONL "error" or
 * "turn.failed" event on stdout (e.g. an invalid model name), while
 * stderr often just carries the harmless "Reading additional input from
 * stdin..." notice. Prefer the stdout event message; fall back to stderr.
 */
function extractCodexError(stdout: string, stderr: string): string {
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  for (const line of lines.reverse()) {
    try {
      const event = JSON.parse(line);
      if (event.type === "turn.failed" && event.error?.message) {
        return String(event.error.message);
      }
      if (event.type === "error" && event.message) {
        return String(event.message);
      }
      if (event.item?.type === "error" && event.item.message) {
        return String(event.item.message);
      }
    } catch {
      continue;
    }
  }
  return stderr.trim() || "(no error detail found in stdout or stderr)";
}

function parseCodexJsonl(stdout: string): AgentRunResult {
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("codex produced no output");
  }

  let sessionId: string | undefined;
  let text = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const events: unknown[] = [];

  for (const line of lines) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // tolerate stray non-JSON lines rather than aborting the whole parse
    }
    events.push(event);

    switch (event.type) {
      case "thread.started":
        sessionId = event.thread_id ?? sessionId;
        break;
      case "item.completed":
        if (event.item?.type === "agent_message" && typeof event.item.text === "string") {
          text = event.item.text;
        }
        break;
      case "turn.completed":
        inputTokens = event.usage?.input_tokens ?? inputTokens;
        outputTokens = event.usage?.output_tokens ?? outputTokens;
        break;
    }
  }

  if (!text) {
    // No agent_message item found - fall back to the raw last line so the
    // user still sees something instead of a silent empty response.
    text = lines[lines.length - 1];
  }

  return { text, sessionId, inputTokens, outputTokens, raw: events };
}
