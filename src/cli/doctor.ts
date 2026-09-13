import chalk from "chalk";
import type { AgentAdapter } from "../agents/AgentAdapter.js";
import { agentColor } from "../ui/colors.js";

export interface DoctorResult {
  agent: string;
  available: boolean;
  message: string;
}

/** Runs every agent's free checkAuth() in parallel - none of these spend
 * a model call, so this is safe to run on every startup, not just on
 * demand via /doctor. */
export async function runDoctorChecks(agents: AgentAdapter[]): Promise<DoctorResult[]> {
  return Promise.all(
    agents.map(async (agent) => {
      try {
        const status = await agent.checkAuth();
        return { agent: agent.name, available: status.available, message: status.message };
      } catch (err) {
        // checkAuth itself should never throw (it's meant to describe
        // failure, not raise it) - but don't let a buggy implementation
        // crash startup over what's supposed to be a diagnostic.
        return { agent: agent.name, available: false, message: (err as Error).message };
      }
    }),
  );
}

export function renderDoctorReport(results: DoctorResult[]): string {
  const lines = [chalk.bold("Agent status:")];
  for (const r of results) {
    const icon = r.available ? chalk.green("✓") : chalk.red("✗");
    lines.push(`  ${icon} ${agentColor(r.agent)(r.agent.padEnd(10))} ${r.message}`);
  }
  return lines.join("\n");
}

/** One-line-per-problem summary for the quiet startup check - silent
 * entirely when everything's fine, so it never adds noise on the common
 * path. */
export function renderStartupWarnings(results: DoctorResult[]): string | null {
  const problems = results.filter((r) => !r.available);
  if (problems.length === 0) return null;
  const lines = problems.map(
    (r) => chalk.yellow(`⚠ ${r.agent}: ${r.message}`),
  );
  lines.push(chalk.dim("  (run /doctor for details; modes using a working agent are unaffected)"));
  return lines.join("\n");
}
