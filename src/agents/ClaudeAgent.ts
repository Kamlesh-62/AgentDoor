import type { AgentAdapter } from "./AgentAdapter.js";
import type { AgentRunOptions, AgentRunResult } from "../types.js";
import { runCommand } from "../utils/spawn.js";

/**
 * Wraps the `claude` CLI in non-interactive (--print) mode.
 *
 * Expected shape of `claude -p ... --output-format json` stdout (fields we
 * rely on): { result: string, session_id: string, total_cost_usd: number,
 * usage: { input_tokens, output_tokens } }. Parsing is defensive - unknown
 * or missing fields degrade gracefully rather than throwing, since the
 * CLI's JSON schema is not a stable, documented contract we control.
 */
export class ClaudeAgent implements AgentAdapter {
  readonly name = "claude" as const;

  constructor(private readonly binary: string = "claude") {}

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const args = ["-p", options.prompt, "--output-format", "json"];
    if (options.model) args.push("--model", options.model);
    if (options.effort) args.push("--effort", options.effort);
    if (options.resumeSessionId) args.push("--resume", options.resumeSessionId);

    const { stdout, stderr, exitCode } = await runCommand(this.binary, args, {
      cwd: options.cwd,
    });

    if (exitCode !== 0) {
      throw new Error(
        `claude exited with code ${exitCode}: ${stderr.trim() || "(no stderr)"}`,
      );
    }

    return parseClaudeOutput(stdout);
  }
}

function parseClaudeOutput(stdout: string): AgentRunResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("claude produced no output");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Fall back to treating raw stdout as the answer if it wasn't JSON -
    // keeps the tool usable even if a claude version changes output shape.
    return { text: trimmed, raw: trimmed };
  }

  const text: string =
    typeof parsed.result === "string"
      ? parsed.result
      : typeof parsed.text === "string"
        ? parsed.text
        : JSON.stringify(parsed);

  return {
    text,
    sessionId: typeof parsed.session_id === "string" ? parsed.session_id : undefined,
    costUsd:
      typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : undefined,
    inputTokens: parsed.usage?.input_tokens ?? undefined,
    outputTokens: parsed.usage?.output_tokens ?? undefined,
    raw: parsed,
  };
}
