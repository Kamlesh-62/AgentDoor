import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Minimal read/write-a-JSON-file-to-disk helper shared by SessionStore and
 * RoutingStateStore. Not a generic database - just enough persistence for
 * "keep session state across runs" without pulling in a dependency.
 */
export class JsonFileStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly defaultValue: T,
  ) {}

  load(): T {
    if (!existsSync(this.filePath)) return structuredClone(this.defaultValue);
    try {
      const raw = readFileSync(this.filePath, "utf8");
      return { ...structuredClone(this.defaultValue), ...JSON.parse(raw) };
    } catch {
      // Corrupt/unreadable state file should not crash the app - start fresh.
      return structuredClone(this.defaultValue);
    }
  }

  save(value: T): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(value, null, 2), "utf8");
  }
}
