import type { AgentAdapter } from "./AgentAdapter.js";
import type { AgentRunOptions, AgentRunResult } from "../types.js";
import { runCommand } from "../utils/spawn.js";

/**
 * Wraps the `claude` CLI in non-interactive (--print) streaming mode.
 *
 * Uses --output-format stream-json (requires --verbose): emits one JSON
 * event per line as the turn progresses (system init, assistant message
 * content blocks - thinking/text/tool_use -, and finally a "result" event)
 * instead of a single blob at the end. The final "result" event carries
 * the same fields the old single-shot json mode did (result, session_id,
 * total_cost_usd, usage.{input,output}_tokens), confirmed against a live
 * call - so parsing logic only needs to pick that one event out of the
 * stream, not learn a new schema.
 */
export class ClaudeAgent implements AgentAdapter {
  readonly name = "claude" as const;

  constructor(private readonly binary: string = "claude") {}

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const args = ["-p", options.prompt, "--output-format", "stream-json", "--verbose"];
    if (options.model) args.push("--model", options.model);
    if (options.effort) args.push("--effort", options.effort);
    if (options.resumeSessionId) args.push("--resume", options.resumeSessionId);

    const { stdout, stderr, exitCode } = await runCommand(this.binary, args, {
      cwd: options.cwd,
      onStdoutLine: (line) => {
        const message = describeClaudeEvent(line);
        if (message) options.onEvent?.(message);
      },
    });

    if (exitCode !== 0) {
      throw new Error(
        `claude exited with code ${exitCode}: ${stderr.trim() || "(no stderr)"}`,
      );
    }

    return parseClaudeStream(stdout);
  }
}

/** Turns one raw stream-json line into a short progress message, or null
 * to suppress it (noisy/internal system events, and content we'll show in
 * full once anyway - e.g. the final text - so it isn't printed twice). */
function describeClaudeEvent(line: string): string | null {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (event.type === "assistant") {
    const block = event.message?.content?.[0];
    if (block?.type === "thinking") return "thinking...";
    if (block?.type === "tool_use") {
      const detail = block.input?.command ?? block.input?.file_path ?? block.input?.path ?? "";
      return `using tool: ${block.name}${detail ? ` (${detail})` : ""}`;
    }
    if (block?.type === "text") return "writing response...";
  }
  return null;
}

function parseClaudeStream(stdout: string): AgentRunResult {
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("claude produced no output");
  }

  let resultEvent: any = null;
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === "result") resultEvent = event;
    } catch {
      continue; // tolerate stray non-JSON lines
    }
  }

  if (!resultEvent) {
    // No "result" event found - fall back to raw stdout so the tool stays
    // usable even if a claude version changes the stream's final shape.
    return { text: stdout.trim(), raw: stdout };
  }

  const text: string =
    typeof resultEvent.result === "string" ? resultEvent.result : JSON.stringify(resultEvent);

  return {
    text,
    sessionId: typeof resultEvent.session_id === "string" ? resultEvent.session_id : undefined,
    costUsd:
      typeof resultEvent.total_cost_usd === "number" ? resultEvent.total_cost_usd : undefined,
    inputTokens: resultEvent.usage?.input_tokens ?? undefined,
    outputTokens: resultEvent.usage?.output_tokens ?? undefined,
    raw: resultEvent,
  };
}
