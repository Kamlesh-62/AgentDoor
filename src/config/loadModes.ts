import type { ModesFile } from "../types.js";
import { loadYaml } from "./loadYaml.js";

export function loadModes(filePath: string): ModesFile {
  const parsed = loadYaml<ModesFile>(filePath);
  if (!parsed.modes || Object.keys(parsed.modes).length === 0) {
    throw new Error(`modes.yaml at "${filePath}" defines no modes`);
  }
  if (!parsed.modes[parsed.default]) {
    throw new Error(
      `modes.yaml "default: ${parsed.default}" does not match any defined mode`,
    );
  }
  return parsed;
}
