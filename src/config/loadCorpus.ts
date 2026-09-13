import { loadYaml } from "./loadYaml.js";

/** mode name -> list of example utterances for that mode. */
export type CorpusFile = Record<string, string[]>;

export function loadCorpus(filePath: string): CorpusFile {
  const parsed = loadYaml<CorpusFile>(filePath);
  for (const [mode, examples] of Object.entries(parsed)) {
    if (!Array.isArray(examples) || examples.length === 0) {
      throw new Error(`corpus.yaml: mode "${mode}" has no example utterances`);
    }
  }
  return parsed;
}
