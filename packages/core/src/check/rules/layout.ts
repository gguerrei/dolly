import { basename } from "node:path";
import { stubContents } from "../../apply/content";
import { ecosystemOfPattern, MANIFEST_OF } from "../../extract/registry";
import { isSafePatternPath, slugify } from "../../pattern/schema";
import { invisibleFile, type Rule, type Violation } from "../rule";
import { existsOnDisk } from "../support";

/** Root manifests are project decisions, not stubs; check never invents one. */
export const MANIFEST_NAMES = new Set(Object.values(MANIFEST_OF));

export const layoutRule: Rule = {
  id: "layout",
  async check({ root, pattern, patternName, inventory, diagnose }) {
    const files = new Set(inventory.files.map((f) => f.path));
    const dirs = new Set(inventory.dirs);
    const projectName = slugify(basename(root), "project");
    const ecosystem = ecosystemOfPattern(pattern);
    const violations: Violation[] = [];

    for (const entry of pattern.layout) {
      if (!isSafePatternPath(entry.path)) {
        diagnose(`layout entry "${entry.path}" is not a safe relative path; not checked.`);
        continue;
      }
      if (!entry.required) continue;
      const isDir = entry.path.endsWith("/");
      const bare = isDir ? entry.path.slice(0, -1) : entry.path;

      if (bare.includes("{name}")) {
        // {name} matches any one segment; with no instance at all, only a
        // human knows what the first one is called.
        const re = nameRegex(bare);
        const pool = isDir ? inventory.dirs : inventory.files.map((f) => f.path);
        if (!pool.some((p) => re.test(p))) {
          violations.push({
            rule: "layout",
            path: entry.path,
            message: `no ${isDir ? "directory" : "file"} matches this required entry, so create the first instance by hand`,
          });
        }
        continue;
      }

      if (isDir ? dirs.has(bare) : files.has(bare)) continue;
      if (!isDir && (await existsOnDisk(root, bare))) {
        violations.push(invisibleFile("layout", entry.path));
        continue;
      }
      const manifest = !isDir && MANIFEST_NAMES.has(bare);
      violations.push({
        rule: "layout",
        path: entry.path,
        message: `required ${isDir ? "directory" : "file"} is missing${manifest ? "; a manifest is a project decision, so create it yourself (or rescaffold with dolly new)" : ""}`,
        ...(manifest
          ? {}
          : {
              fix: isDir
                ? // Creating the .gitkeep creates the directory with it.
                  { kind: "create", path: `${bare}/.gitkeep`, contents: "" }
                : {
                    kind: "create",
                    path: bare,
                    contents: stubContents(bare, projectName, patternName, pattern, ecosystem),
                  },
            }),
      });
    }
    return violations;
  },
};

/** "packages/{name}/tsconfig.json" → /^packages\/[^/]+\/tsconfig\.json$/, which fit matches against too. */
export function nameRegex(path: string): RegExp {
  const parts = path.split("{name}").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${parts.join("[^/]+")}$`);
}
