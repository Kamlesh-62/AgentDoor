import { spawn } from "node:child_process";

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Promise wrapper around child_process.spawn. Deliberately does not use a
 * shell (args passed as an array) so prompts containing quotes/newlines
 * can't break argument parsing or inject shell commands.
 */
export function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(
        new Error(
          `Failed to spawn "${command}": ${err.message}. Is it installed and on PATH?`,
        ),
      );
    });

    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`"${command}" timed out after ${opts.timeoutMs}ms`));
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });
  });
}
