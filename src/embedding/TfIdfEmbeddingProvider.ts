import type { EmbeddingProvider } from "./EmbeddingProvider.js";
import { tokenize } from "../utils/textNormalize.js";

/**
 * Default, fully local/offline EmbeddingProvider: classic TF-IDF over a
 * fitted vocabulary. It captures word overlap weighted by how distinctive
 * each word is across the corpus - not true semantic/neural embedding
 * (it won't know "car" and "automobile" are related), but it needs no
 * network call, no model download, and no API key, which fits the
 * "terminal CLIs only" constraint exactly.
 *
 * Swap this for a neural embedding provider later (e.g. a local
 * transformer model) by implementing EmbeddingProvider - nothing else in
 * the routing layer needs to change.
 */
export class TfIdfEmbeddingProvider implements EmbeddingProvider {
  private vocabulary: string[] = [];
  private idf: Map<string, number> = new Map();

  fit(documents: string[]): void {
    const docTokenSets = documents.map((doc) => new Set(tokenize(doc)));
    const vocabSet = new Set<string>();
    for (const set of docTokenSets) for (const tok of set) vocabSet.add(tok);
    this.vocabulary = [...vocabSet];

    const n = documents.length;
    this.idf = new Map();
    for (const term of this.vocabulary) {
      const docsContaining = docTokenSets.filter((set) => set.has(term)).length;
      // Standard smoothed IDF: log(N / (1 + df)) + 1, always positive.
      const idf = Math.log(n / (1 + docsContaining)) + 1;
      this.idf.set(term, idf);
    }
  }

  embed(text: string): number[] {
    if (this.vocabulary.length === 0) {
      throw new Error("TfIdfEmbeddingProvider.embed() called before fit()");
    }
    const tokens = tokenize(text);
    const termFreq = new Map<string, number>();
    for (const tok of tokens) termFreq.set(tok, (termFreq.get(tok) ?? 0) + 1);

    return this.vocabulary.map((term) => {
      const tf = termFreq.get(term) ?? 0;
      if (tf === 0) return 0;
      return (tf / tokens.length) * (this.idf.get(term) ?? 0);
    });
  }
}
