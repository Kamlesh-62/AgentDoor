import { readFileSync } from "node:fs";
import yaml from "js-yaml";

/** Reads and parses a YAML file. Throws with the file path on failure,
 * since a broken config file should stop startup, not silently no-op. */
export function loadYaml<T>(filePath: string): T {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`Could not read config file "${filePath}": ${(err as Error).message}`);
  }
  try {
    return yaml.load(raw) as T;
  } catch (err) {
    throw new Error(`Could not parse YAML in "${filePath}": ${(err as Error).message}`);
  }
}
