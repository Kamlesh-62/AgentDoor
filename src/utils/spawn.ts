import { spawn } from "node:child_process";

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** Thrown instead of a generic Error when a command was aborted via
 * `signal`, so callers can distinguish "user cancelled this" from a real
 * failure (e.g. skip printing a scary red error for a deliberate cancel). */
export class CancelledError extends Error {
  constructor(command: string) {
    super(`"${command}" was cancelled`);
    this.name = "CancelledError";
  }
}

export interface RunCommandOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Called with each complete line of stdout as it arrives, in addition
   * to (not instead of) the full buffered stdout returned on completion -
   * lets callers show live progress without changing how the final
   * output is parsed. */
  onStdoutLine?: (line: string) => void;
  /** Aborting this kills the subprocess and rejects with CancelledError. */
  signal?: AbortSignal;
}

/**
 * Promise wrapper around child_process.spawn. Deliberately does not use a
 * shell (args passed as an array) so prompts containing quotes/newlines
 * can't break argument parsing or inject shell commands.
 */
export function runCommand(
  command: string,
  args: string[],
  opts: RunCommandOptions = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal: opts.signal,
    });

    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    let timedOut = false;
    let cancelled = opts.signal?.aborted ?? false;

    opts.signal?.addEventListener("abort", () => {
      cancelled = true;
    });

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;

      if (opts.onStdoutLine) {
        lineBuffer += text;
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? ""; // keep the trailing partial line for next chunk
        for (const line of lines) {
          if (line.trim()) opts.onStdoutLine(line);
        }
      }
    });
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      if (cancelled || err.name === "AbortError") {
        reject(new CancelledError(command));
        return;
      }
      reject(
        new Error(
          `Failed to spawn "${command}": ${err.message}. Is it installed and on PATH?`,
        ),
      );
    });

    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer);
      if (cancelled) {
        reject(new CancelledError(command));
        return;
      }
      if (opts.onStdoutLine && lineBuffer.trim()) {
        opts.onStdoutLine(lineBuffer); // flush any trailing line with no final newline
      }
      if (timedOut) {
        reject(new Error(`"${command}" timed out after ${opts.timeoutMs}ms`));
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });
  });
}
