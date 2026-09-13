import { loadYaml } from "./loadYaml.js";

export interface ModelRate {
  inputPer1M: number;
  outputPer1M: number;
}

export interface PricingFile {
  models: Record<string, ModelRate>;
}

export function loadPricing(filePath: string): PricingFile {
  return loadYaml<PricingFile>(filePath);
}
