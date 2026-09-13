import chalk from "chalk";
import type { ModeResolver } from "./ModeResolver.js";
import type { AgentAdapter } from "../agents/AgentAdapter.js";
import type { UsageTracker } from "../usage/UsageTracker.js";
import type { ModesFile, RoutingContext, RoutingDecision } from "../types.js";

/**
 * Last-resort resolver before DefaultResolver: when the embedding resolver
 * found the prompt genuinely ambiguous (and there's no sticky mode to fall
 * back on), ask a cheap model to make the semantic judgment call instead.
 * Still goes through the `claude` CLI (no raw API calls), and its cost is
 * logged to UsageTracker as an internal entry since it's a real, billed
 * turn even though the user never sees it directly.
 *
 * Fails open: any error or unparseable response returns null so routing
 * falls through to DefaultResolver rather than crashing the turn.
 */
export class LlmEscalationResolver implements ModeResolver {
  constructor(
    private readonly classifierAgent: AgentAdapter,
    private readonly modesFile: ModesFile,
    private readonly usageTracker: UsageTracker,
    private readonly classifierModel: string = "haiku",
  ) {}

  async resolve(ctx: RoutingContext): Promise<RoutingDecision | null> {
    const modeNames = Object.keys(this.modesFile.modes);
    const prompt = buildClassifierPrompt(modeNames, ctx);

    console.error(chalk.dim("(ambiguous prompt - asking classifier which mode to use...)"));

    let resultText: string;
    try {
      const result = await this.classifierAgent.run({
        prompt,
        model: this.classifierModel,
        effort: "low",
      });
      this.usageTracker.record({
        agent: this.classifierAgent.name,
        model: this.classifierModel,
        mode: "(routing)",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        internal: true,
      });
      resultText = result.text;
    } catch {
      return null; // fail open - let DefaultResolver handle it
    }

    const parsed = extractJson(resultText);
    if (!parsed || typeof parsed.mode !== "string") return null;

    const modeName = parsed.mode.toLowerCase();
    const cfg = this.modesFile.modes[modeName];
    if (!cfg) return null; // model picked something not in our mode list

    return {
      mode: modeName,
      agent: cfg.agent,
      model: cfg.model,
      effort: cfg.effort,
      readOnly: cfg.readOnly ?? true,
      source: "llm-escalation",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
      reason: typeof parsed.reason === "string" ? parsed.reason : "llm escalation classification",
      cleanedPrompt: ctx.rawPrompt,
    };
  }
}

function buildClassifierPrompt(modeNames: string[], ctx: RoutingContext): string {
  const recent = ctx.recentPrompts.length
    ? `Recent prompts, oldest first:\n${ctx.recentPrompts.map((p) => `- ${p}`).join("\n")}\n\n`
    : "";
  return [
    `You are a routing classifier for a dev tool. Pick exactly one mode for the`,
    `following prompt from this list: ${modeNames.join(", ")}.`,
    ``,
    recent + `Current prompt: "${ctx.rawPrompt}"`,
    ``,
    `Reply with ONLY a single JSON object, no prose, no markdown fences:`,
    `{"mode": "<one of the listed modes>", "confidence": <0 to 1>, "reason": "<short reason>"}`,
  ].join("\n");
}

function extractJson(text: string): { mode?: string; confidence?: number; reason?: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
