import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentName, UsageEntry } from "../types.js";
import type { PricingFile } from "../config/loadPricing.js";
import { estimateCost } from "./PricingTable.js";

export interface RecordUsageInput {
  agent: AgentName;
  model: string;
  mode: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Direct cost report from the agent, if any. Falls back to an estimate
   * from PricingTable when omitted. */
  costUsd?: number;
  /** True for internal calls (e.g. LLM escalation classification) that
   * aren't a user-visible turn but still cost real money. */
  internal?: boolean;
}

export interface UsageSummaryRow {
  agent: AgentName;
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageSummary {
  rows: UsageSummaryRow[];
  totalCostUsd: number;
  totalTurns: number;
}

/**
 * Accumulates per-turn token/cost data in memory for the running session
 * and appends one summary row per session to a persistent log on exit.
 * Kept separate from SessionStore/RoutingStateStore since this is
 * accounting data, not routing or conversation state.
 */
export class UsageTracker {
  private readonly entries: UsageEntry[] = [];

  constructor(
    private readonly pricing: PricingFile,
    private readonly logFilePath: string,
  ) {}

  record(input: RecordUsageInput): UsageEntry {
    const inputTokens = input.inputTokens ?? 0;
    const outputTokens = input.outputTokens ?? 0;
    const costUsd =
      input.costUsd ?? estimateCost(input.model, inputTokens, outputTokens, this.pricing);

    const entry: UsageEntry = {
      timestamp: new Date().toISOString(),
      agent: input.agent,
      model: input.model,
      mode: input.mode,
      inputTokens,
      outputTokens,
      costUsd,
      internal: input.internal ?? false,
    };
    this.entries.push(entry);
    return entry;
  }

  summarize(): UsageSummary {
    const rowsByKey = new Map<string, UsageSummaryRow>();
    for (const e of this.entries) {
      const key = `${e.agent}::${e.model}`;
      const row = rowsByKey.get(key) ?? {
        agent: e.agent,
        model: e.model,
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      };
      row.turns += 1;
      row.inputTokens += e.inputTokens;
      row.outputTokens += e.outputTokens;
      row.costUsd += e.costUsd ?? 0;
      rowsByKey.set(key, row);
    }
    const rows = [...rowsByKey.values()];
    return {
      rows,
      totalCostUsd: rows.reduce((sum, r) => sum + r.costUsd, 0),
      totalTurns: this.entries.filter((e) => !e.internal).length,
    };
  }

  /** Appends this session's summary as one line to the append-only log. */
  persistSessionSummary(): UsageSummary {
    const summary = this.summarize();
    mkdirSync(dirname(this.logFilePath), { recursive: true });
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...summary });
    appendFileSync(this.logFilePath, line + "\n", "utf8");
    return summary;
  }
}
