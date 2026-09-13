import type { UnavailableReason } from "../types.js";

/**
 * Thrown instead of a generic Error when a dispatch fails for a reason the
 * user can actually act on (not logged in, out of quota, binary missing) -
 * so the REPL can print a plain, specific instruction instead of a raw
 * CLI stack trace. Any other failure stays a plain Error; this is only
 * for the classifiable cases.
 */
export class AgentUnavailableError extends Error {
  constructor(
    public readonly agent: string,
    public readonly reason: UnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = "AgentUnavailableError";
  }
}

/**
 * Matches known "you can't use this agent right now" signatures in a
 * CLI's combined output. Each agent's own known phrases are passed in
 * separately (they don't share a vocabulary) - this just does the
 * generic classify-or-not part once instead of three times.
 */
export function classifyUnavailable(
  text: string,
  patterns: { reason: UnavailableReason; matches: RegExp[] }[],
): UnavailableReason | null {
  for (const { reason, matches } of patterns) {
    if (matches.some((re) => re.test(text))) return reason;
  }
  return null;
}
