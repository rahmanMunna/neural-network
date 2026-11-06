// #region boundaries
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Rules decay unless a machine enforces them. This returns every import that
 * reaches into another module's private files. Run it in CI and fail on any.
 */
export function findBoundaryViolations(root: string) {
  const modules = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => entry.name);
  const violations: string[] = [];

  for (const name of modules) {
    const folder = join(root, name);
    const files = readdirSync(folder, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));

    for (const file of files) {
      const path = join(folder, file);
      const imports = readFileSync(path, "utf8").matchAll(/from\s+"(\.[^"]+)"/g);
      for (const [, target] of imports) {
        const resolved = relative(root, resolve(dirname(path), target!));
        const [owner, ...rest] = resolved.split(/[\\/]/);
        const isOtherModule = owner !== name && modules.includes(owner!);
        if (isOtherModule && rest.join("/") !== "index.js") {
          violations.push(`${join(name, file)} -> ${resolved}`);
        }
      }
    }
  }
  return violations;
}
// #endregion
