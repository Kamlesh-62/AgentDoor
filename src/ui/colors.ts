import chalk from "chalk";
import type { AgentName } from "../types.js";

/** One consistent color per agent across the whole UI (box header, status
 * line, prompt) so which agent is active is recognizable at a glance.
 * Only claude/codex get their real brand-ish colors, confirmed against
 * their actual product identity; grok and any other agent name fall
 * through to a deterministic palette below - distinguishable from each
 * other, not claimed as anyone's real brand color. */
const AGENT_COLORS: Record<string, (text: string) => string> = {
  claude: chalk.hex("#D97757"), // Claude's own brand-ish warm tone
  codex: chalk.hex("#10A37F"), // Codex/OpenAI's brand-ish teal
};

/** Distinct, readable-on-dark-and-light hues for agents with no explicit
 * entry above - picked for contrast from each other and from claude/codex,
 * not from any brand. Cycled deterministically by name so the same custom
 * agent always gets the same color across a session and across restarts. */
const FALLBACK_PALETTE = ["#8B7FD6", "#3B9EDB", "#C9A227", "#D6597F"];

export function agentColor(agent: AgentName): (text: string) => string {
  if (AGENT_COLORS[agent]) return AGENT_COLORS[agent];
  const index = hashString(agent) % FALLBACK_PALETTE.length;
  return chalk.hex(FALLBACK_PALETTE[index]);
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
