import chalk from "chalk";
import type { AgentName } from "../types.js";

/** One consistent color per agent across the whole UI (box header, status
 * line, prompt) so which agent is active is recognizable at a glance. */
const AGENT_COLORS: Record<AgentName, (text: string) => string> = {
  claude: chalk.hex("#D97757"), // Claude's own brand-ish warm tone
  codex: chalk.hex("#10A37F"), // Codex/OpenAI's brand-ish teal
};

export function agentColor(agent: AgentName): (text: string) => string {
  return AGENT_COLORS[agent] ?? chalk.white;
}
