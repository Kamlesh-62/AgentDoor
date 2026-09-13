import type { ModeResolver } from "./ModeResolver.js";
import type { EmbeddingProvider } from "../embedding/EmbeddingProvider.js";
import type { CorpusFile } from "../config/loadCorpus.js";
import type { ModesFile, RoutingContext, RoutingDecision } from "../types.js";
import { cosineSimilarity } from "../utils/cosine.js";

export interface EmbeddingResolverOptions {
  /** Minimum top-mode score to trust at all; below this, decline (return null). */
  minConfidence: number;
  /** When already in a sticky mode, how much better a rival mode's score
   * must be before switching away from it (hysteresis, avoids flapping). */
  switchMargin: number;
}

const DEFAULT_OPTIONS: EmbeddingResolverOptions = {
  minConfidence: 0.08,
  switchMargin: 0.05,
};

/**
 * Semantic routing: embeds the current prompt (plus recent prompts for
 * context) and compares it to each mode's example-utterance centroid via
 * cosine similarity - no keyword/regex matching. Declines (null) only when
 * genuinely ambiguous with no sticky mode to fall back on, handing off to
 * the LLM escalation resolver next in the chain.
 */
export class EmbeddingResolver implements ModeResolver {
  private readonly centroids: Map<string, number[]>;

  constructor(
    private readonly embedder: EmbeddingProvider,
    corpus: CorpusFile,
    private readonly modesFile: ModesFile,
    private readonly options: EmbeddingResolverOptions = DEFAULT_OPTIONS,
  ) {
    this.centroids = new Map(
      Object.entries(corpus).map(([mode, examples]) => [
        mode,
        averageVector(examples.map((e) => embedder.embed(e))),
      ]),
    );
  }

  async resolve(ctx: RoutingContext): Promise<RoutingDecision | null> {
    const contextText = [...ctx.recentPrompts, ctx.rawPrompt].join(". ");
    const vector = this.embedder.embed(contextText);

    const scores = [...this.centroids.entries()]
      .map(([mode, centroid]) => ({ mode, score: cosineSimilarity(vector, centroid) }))
      .sort((a, b) => b.score - a.score);

    const top = scores[0];
    if (!top || top.score < this.options.minConfidence) {
      if (ctx.currentMode) {
        return this.buildDecision(
          ctx.currentMode,
          ctx.rawPrompt,
          "sticky",
          top?.score,
          "semantic match too weak; staying in current mode",
        );
      }
      return null; // genuinely ambiguous with nothing to fall back on
    }

    if (ctx.currentMode && ctx.currentMode !== top.mode) {
      const currentScore = scores.find((s) => s.mode === ctx.currentMode)?.score ?? 0;
      if (top.score - currentScore < this.options.switchMargin) {
        return this.buildDecision(
          ctx.currentMode,
          ctx.rawPrompt,
          "sticky",
          currentScore,
          `"${top.mode}" scored higher but not enough to switch away from "${ctx.currentMode}"`,
        );
      }
    }

    return this.buildDecision(
      top.mode,
      ctx.rawPrompt,
      "embedding",
      top.score,
      `best semantic match (score ${top.score.toFixed(3)})`,
    );
  }

  private buildDecision(
    modeName: string,
    cleanedPrompt: string,
    source: "embedding" | "sticky",
    confidence: number | undefined,
    reason: string,
  ): RoutingDecision {
    const cfg = this.modesFile.modes[modeName];
    if (!cfg) {
      throw new Error(`EmbeddingResolver: mode "${modeName}" not found in modes.yaml`);
    }
    return {
      mode: modeName,
      agent: cfg.agent,
      model: cfg.model,
      effort: cfg.effort,
      readOnly: cfg.readOnly ?? true,
      source,
      confidence,
      reason,
      cleanedPrompt,
    };
  }
}

function averageVector(vectors: number[][]): number[] {
  const length = vectors[0]?.length ?? 0;
  const sum = new Array(length).fill(0);
  for (const v of vectors) for (let i = 0; i < length; i++) sum[i] += v[i];
  return sum.map((s) => s / vectors.length);
}
