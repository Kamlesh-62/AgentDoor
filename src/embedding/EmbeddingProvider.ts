/**
 * Turns text into a numeric vector for semantic similarity comparisons.
 *
 * This is the extension point for "real" semantic search later: swap
 * TfIdfEmbeddingProvider for one backed by a local transformer model or a
 * hosted embeddings endpoint without touching EmbeddingRouter, which only
 * depends on this interface.
 */
export interface EmbeddingProvider {
  /** Learn vocabulary/statistics from a corpus. Must be called before embed(). */
  fit(documents: string[]): void;
  /** Convert a single piece of text into a vector, using what fit() learned. */
  embed(text: string): number[];
}
