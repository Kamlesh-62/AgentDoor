import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { AgentAdapter } from "./AgentAdapter.js";
import type { AgentRunOptions, AgentRunResult, AuthStatus } from "../types.js";
import type { GenericAgentConfig } from "../config/loadAgents.js";
import { runCommand } from "../utils/spawn.js";
import { AgentUnavailableError } from "./errors.js";

/**
 * Drives any CLI shaped like "binary [flags] <prompt>" purely from a
 * config/agents.yaml entry - no TypeScript needed to add a new agent that
 * fits this shape. This is the "any model, not just claude/codex/grok"
 * extension point: config/agents.yaml is the actual open surface, this
 * class is just the engine that reads it.
 */
export class GenericCliAgent implements AgentAdapter {
  constructor(
    readonly name: string,
    private readonly cfg: GenericAgentConfig,
  ) {}

  async checkAuth(): Promise<AuthStatus> {
    // Binary presence is checked first regardless of which auth signal
    // is configured, so "not installed" and "installed but not logged
    // in" are never confused with each other.
    const installed = await this.binaryExists();
    if (!installed) {
      return {
        available: false,
        reason: "not-installed",
        message: `${this.name} CLI ("${this.cfg.binary}") not found on PATH`,
      };
    }

    if (this.cfg.authFile) {
      const path = this.cfg.authFile.replace(/^~/, homedir());
      if (existsSync(path)) {
        return { available: true, message: `${this.name} credential file found at ${path}` };
      }
      return {
        available: false,
        reason: "not-logged-in",
        message: `${this.name} has no credential file at ${path} - log in first`,
      };
    }

    if (!this.cfg.authCheckArgs) {
      // No status command or credential file configured - binary
      // existing is the most we can confirm for free.
      return { available: true, message: `${this.name} binary found (no auth check configured)` };
    }

    const result = await runCommand(this.cfg.binary, this.cfg.authCheckArgs);
    const output = `${result.stdout}\n${result.stderr}`;
    if (this.cfg.notLoggedInPattern && new RegExp(this.cfg.notLoggedInPattern, "i").test(output)) {
      return {
        available: false,
        reason: "not-logged-in",
        message: `${this.name} is not logged in`,
      };
    }
    if (this.cfg.loggedInPattern && new RegExp(this.cfg.loggedInPattern, "i").test(output)) {
      return { available: true, message: `${this.name} is logged in` };
    }
    return {
      available: false,
      reason: "unknown",
      message: `${this.name} auth check returned unrecognized output: ${output.slice(0, 200)}`,
    };
  }

  private async binaryExists(): Promise<boolean> {
    try {
      await runCommand(this.cfg.binary, ["--version"]);
      return true;
    } catch {
      return false;
    }
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const args: string[] = [...(this.cfg.extraArgs ?? [])];

    if (this.cfg.promptMode === "flag") {
      if (!this.cfg.promptFlag) {
        throw new Error(`agents.yaml: "${this.name}" uses promptMode "flag" but sets no promptFlag`);
      }
      args.push(this.cfg.promptFlag, options.prompt);
    } else {
      args.push(options.prompt);
    }

    if (options.model && this.cfg.modelFlag) args.push(this.cfg.modelFlag, options.model);
    if (options.effort && this.cfg.effortFlag) args.push(this.cfg.effortFlag, options.effort);
    if (options.resumeSessionId && this.cfg.resumeFlag) {
      args.push(this.cfg.resumeFlag, options.resumeSessionId);
    }
    const permissionArgs =
      options.readOnly !== false ? this.cfg.readOnlyArgs : this.cfg.writeArgs;
    if (permissionArgs) args.push(...permissionArgs);

    const { stdout, stderr, exitCode } = await runCommand(this.cfg.binary, args, {
      cwd: options.cwd,
      signal: options.signal,
    });

    if (exitCode !== 0) {
      const combined = `${stdout}\n${stderr}`;
      if (this.cfg.notLoggedInPattern && new RegExp(this.cfg.notLoggedInPattern, "i").test(combined)) {
        throw new AgentUnavailableError(this.name, "not-logged-in", `${this.name} is not logged in`);
      }
      throw new Error(`${this.name} exited with code ${exitCode}: ${stderr.trim() || "(no stderr)"}`);
    }

    return parseGenericOutput(stdout, this.cfg.fields ?? {});
  }
}

/** Reads a dot-notation path ("usage.input_tokens") out of a parsed
 * object, returning undefined for any missing/invalid segment rather
 * than throwing - a CLI's JSON is not a contract this class controls. */
function getPath(obj: unknown, path: string | undefined): unknown {
  if (!path || obj == null || typeof obj !== "object") return undefined;
  return path
    .split(".")
    .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as any)[key] : undefined), obj);
}

function parseGenericOutput(stdout: string, fields: NonNullable<GenericAgentConfig["fields"]>): AgentRunResult {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("no output produced");

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Not JSON - treat the whole thing as the answer text. Reasonable
    // default for CLIs with no --output-format json equivalent configured.
    return { text: trimmed, raw: trimmed };
  }

  const text = getPath(parsed, fields.text);
  return {
    text: typeof text === "string" ? text : trimmed,
    sessionId: asString(getPath(parsed, fields.sessionId)),
    costUsd: asNumber(getPath(parsed, fields.costUsd)),
    inputTokens: asNumber(getPath(parsed, fields.inputTokens)),
    outputTokens: asNumber(getPath(parsed, fields.outputTokens)),
    raw: parsed,
  };
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
