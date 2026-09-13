import { loadYaml } from "./loadYaml.js";

/**
 * Config shape for a CLI wired up WITHOUT writing any code - the generic
 * path. Works for any agent CLI shaped like "binary [flags] <prompt>",
 * optionally emitting JSON with the answer/session/cost/tokens somewhere
 * in it. Claude and Codex are NOT examples of this - their output formats
 * (stream-json, JSONL) are genuinely special enough to need a real class -
 * but a great many CLIs follow this common shape closely enough that
 * writing TypeScript for each one would just be boilerplate.
 */
export interface GenericAgentConfig {
  /** Binary name/path to spawn. */
  binary: string;
  /** How the prompt is passed: "positional" (default) appends it as a
   * bare argument; "flag" passes it as the value of `promptFlag`. */
  promptMode?: "positional" | "flag";
  promptFlag?: string;
  modelFlag?: string;
  effortFlag?: string;
  resumeFlag?: string;
  /** Extra fixed flags always included, e.g. ["--output-format", "json"]. */
  extraArgs?: string[];
  /** Flags added when NOT allowed to write/run commands, and when it is. */
  readOnlyArgs?: string[];
  writeArgs?: string[];
  /** Dot-notation paths into the parsed JSON output for each field, e.g.
   * "usage.input_tokens". Omit a field if the CLI doesn't report it. */
  fields?: {
    text?: string;
    sessionId?: string;
    costUsd?: string;
    inputTokens?: string;
    outputTokens?: string;
  };
  /** Optional free preflight check, e.g. ["auth", "status"]. Whatever it
   * prints is matched against loggedInPattern/notLoggedInPattern. Omit
   * entirely if the CLI has no such command. */
  authCheckArgs?: string[];
  loggedInPattern?: string;
  notLoggedInPattern?: string;
  /** Alternative/additional check for CLIs with no free status command:
   * a credential file whose mere existence is a reasonable "probably
   * logged in" signal (e.g. "~/.grok/auth.json"). "~" expands to the
   * home directory. Checked before authCheckArgs if both are set. */
  authFile?: string;
}

export interface AgentsFile {
  /** Agents implemented as a real TypeScript class (ClaudeAgent, etc.) -
   * listed here only so `/doctor` and docs know they exist; this config
   * doesn't drive their behavior at all. */
  builtin?: string[];
  /** Agents wired up purely from this file, via GenericCliAgent. */
  generic?: Record<string, GenericAgentConfig>;
}

export function loadAgents(filePath: string): AgentsFile {
  const parsed = loadYaml<AgentsFile>(filePath) ?? {};
  return { builtin: parsed.builtin ?? [], generic: parsed.generic ?? {} };
}
