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

    const { stdout, stderr, exitCode } = await runCommand(this.binary, args, {
      cwd: options.cwd,
    });

    if (exitCode !== 0) {
      throw new Error(
        `codex exited with code ${exitCode}: ${extractCodexError(stdout, stderr)}`,
      );
    }

    return parseCodexJsonl(stdout);
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
