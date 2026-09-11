import { afterAll, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LAYOUT_TUNING, scanLayout } from "../src/extract/layout";
import type { Inventory } from "../src/tree/inventory";
import { cleanupTempRoots, tempDir } from "./support";

afterAll(cleanupTempRoots);

/**
 * Direct unit tests over the layout scanner's voting constants: the
 * numbers in LAYOUT_TUNING are policy, and policy must be falsifiable.
 * The inventory is synthesized, so each test steers exactly one lever.
 */

async function inventory(dirs: string[], files: string[]): Promise<Inventory> {
  return {
    root: await tempDir("dolly-layout-"),
    dirs: [...dirs].sort(),
    files: [...files].sort().map((path) => ({ path, size: 16 })),
    vendored: [],
    denied: [],
    lockfiles: [],
  };
}

const paths = (scan: { layout: { path: string }[] }) => scan.layout.map((e) => e.path);

describe("sibling voting (minGroup, coreRatio)", () => {
  test("three uniform siblings become a {name} template; their shared files are the core", async () => {
    const inv = await inventory(
      ["packages", "packages/api", "packages/web", "packages/cli"],
      [
        "packages/api/index.ts",
        "packages/api/api.test.ts",
        "packages/web/index.ts",
        "packages/web/web.test.ts",
        "packages/cli/index.ts",
        "packages/cli/cli.test.ts",
      ],
    );
    const scan = await scanLayout(inv, new Set());
    expect(paths(scan)).toContain("packages/{name}/");
    expect(paths(scan)).toContain("packages/{name}/index.ts");
    expect(paths(scan)).toContain("packages/{name}/{name}.test.ts");
    // Every member carries both core files, so both are required.
    const core = scan.layout.find((e) => e.path === "packages/{name}/index.ts");
    expect(core?.required).toBe(true);
    // The members are owned by the group, not re-listed as literal dirs.
    expect(paths(scan)).not.toContain("packages/api/");
  });

  test("two siblings are below minGroup: the vote never opens, the dirs stay literal", async () => {
    const inv = await inventory(
      ["packages", "packages/api", "packages/web"],
      [
        "packages/api/index.ts",
        "packages/api/api.test.ts",
        "packages/web/index.ts",
        "packages/web/web.test.ts",
      ],
    );
    const scan = await scanLayout(inv, new Set());
    expect(paths(scan)).not.toContain("packages/{name}/");
    expect(paths(scan)).toContain("packages/api/");
    expect(scan.notes).toEqual([]);
  });

  test("one shared file across all members is a real convention but too thin: a note, not a template", async () => {
    const inv = await inventory(
      ["packages", "packages/api", "packages/web", "packages/cli"],
      ["packages/api/index.ts", "packages/web/index.ts", "packages/cli/index.ts"],
    );
    const scan = await scanLayout(inv, new Set());
    expect(paths(scan)).not.toContain("packages/{name}/");
    expect(scan.notes.join("\n")).toContain("too thin for a {name} template");
  });

  test("coreRatio: a file in 3 of 5 members is core but optional; in 5 of 5 it is required", async () => {
    const members = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const files = members.flatMap((m) => [`mods/${m}/index.ts`, `mods/${m}/${m}.ts`]);
    for (const m of members.slice(0, 3)) files.push(`mods/${m}/util.ts`);
    const inv = await inventory(["mods", ...members.map((m) => `mods/${m}`)], files);
    const scan = await scanLayout(inv, new Set());
    const util = scan.layout.find((e) => e.path === "mods/{name}/util.ts");
    const index = scan.layout.find((e) => e.path === "mods/{name}/index.ts");
    expect(util).toBeDefined(); // 3/5 clears ceil(5 * 6/10) = 3
    expect(util?.required).toBe(false);
    expect(index?.required).toBe(true);
  });

  test("a stoplisted majority never votes: src/utils|helpers|models is vocabulary, not instances", async () => {
    const inv = await inventory(
      ["src", "src/utils", "src/helpers", "src/models"],
      [
        "src/utils/index.ts",
        "src/utils/utils.test.ts",
        "src/helpers/index.ts",
        "src/helpers/helpers.test.ts",
        "src/models/index.ts",
        "src/models/models.test.ts",
      ],
    );
    const scan = await scanLayout(inv, new Set());
    expect(paths(scan)).not.toContain("src/{name}/");
    expect(paths(scan)).toContain("src/utils/");
  });

  test("a declared workspace lowers the bar: two members template when the manifest names them", async () => {
    const inv = await inventory(
      ["packages", "packages/api", "packages/web"],
      ["packages/api/index.ts", "packages/web/index.ts"],
    );
    await writeFile(join(inv.root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    const scan = await scanLayout(inv, new Set());
    expect(paths(scan)).toContain("packages/{name}/");
    expect(paths(scan)).toContain("packages/{name}/index.ts");
  });
});

describe("file-per-resource voting", () => {
  test("a uniform leaf dir generalizes to {name}, with index-style names excluded from the vote", async () => {
    const inv = await inventory(
      ["routers"],
      ["routers/users.py", "routers/orders.py", "routers/billing.py", "routers/__init__.py"],
    );
    const scan = await scanLayout(inv, new Set());
    expect(paths(scan)).toContain("routers/{name}.py");
    const group = scan.templateGroups.find((g) => g.target === "routers/{name}.py");
    expect(group?.members.map((m) => m.name).sort()).toEqual(["billing", "orders", "users"]);
  });

  test("mixed shapes stay literal, with a note naming the mix", async () => {
    const inv = await inventory(
      ["handlers"],
      [
        "handlers/a.py",
        "handlers/b.py",
        "handlers/c.py",
        "handlers/x.go",
        "handlers/y.go",
        "handlers/z.go",
      ],
    );
    const scan = await scanLayout(inv, new Set());
    expect(paths(scan)).not.toContain("handlers/{name}.py");
    expect(scan.notes.join("\n")).toContain("mixes file shapes");
  });

  test("two resource files are below minGroup: nothing is generalized", async () => {
    const inv = await inventory(["routers"], ["routers/users.py", "routers/orders.py"]);
    const scan = await scanLayout(inv, new Set());
    expect(paths(scan)).not.toContain("routers/{name}.py");
  });
});

describe("depth, requiredness, and anchors", () => {
  test("maxDepth caps literal dirs, but a single-child chain collapses to one level", async () => {
    const inv = await inventory(
      [
        // Branching at every level: five real levels, one past the cap.
        "v",
        "v/w",
        "v/w/x",
        "v/w/x/y",
        "v/w/x/y/z",
        // A Java-style chain: single children collapse, so the leaf survives.
        "com",
        "com/example",
        "com/example/app",
        "com/example/app/web",
        "com/example/app/data",
      ],
      ["v/a.txt", "v/w/a.txt", "v/w/x/a.txt", "v/w/x/y/a.txt"],
    );
    const scan = await scanLayout(inv, new Set());
    expect(paths(scan)).toContain("v/w/x/y/");
    expect(paths(scan)).not.toContain("v/w/x/y/z/");
    expect(paths(scan)).toContain("com/example/app/web/");
  });

  test("requiredness: root vocabulary and .gitkeep say required, an arbitrary dir does not", async () => {
    const inv = await inventory(
      ["src", "stuff", "empty"],
      ["empty/.gitkeep", "README.md", "notes.txt"],
    );
    const scan = await scanLayout(inv, new Set());
    expect(scan.layout.find((e) => e.path === "src/")?.required).toBe(true);
    expect(scan.layout.find((e) => e.path === "stuff/")?.required).toBe(false);
    expect(scan.layout.find((e) => e.path === "empty/")?.required).toBe(true);
    expect(scan.layout.find((e) => e.path === "README.md")?.required).toBe(true);
    expect(paths(scan)).not.toContain("notes.txt");
  });

  test("a toolchain-claimed config is kept, optional, wherever it lives", async () => {
    const inv = await inventory(["config"], ["config/settings.json"]);
    const scan = await scanLayout(inv, new Set(["config/settings.json"]));
    expect(scan.layout.find((e) => e.path === "config/settings.json")?.required).toBe(false);
  });
});

describe("the entry budget", () => {
  test("over budget, the deepest optional entries drop first and the note says so", async () => {
    const extras = Array.from({ length: 60 }, (_, i) => `deep/d${String(i).padStart(2, "0")}`);
    const inv = await inventory(["src", "deep", ...extras], ["README.md"]);
    const scan = await scanLayout(inv, new Set());
    expect(scan.layout.length).toBe(LAYOUT_TUNING.entryBudget);
    expect(scan.notes.join("\n")).toContain(`truncated to ${LAYOUT_TUNING.entryBudget}`);
    // Required survivors: the budget only ever eats optional depth.
    expect(paths(scan)).toContain("src/");
    expect(paths(scan)).toContain("README.md");
  });

  test("a {name} group lists its best supported core paths and counts the rest in a note", async () => {
    const members = ["a", "b", "c", "d"];
    const shared = Array.from({ length: 12 }, (_, i) => `page${String(i).padStart(2, "0")}.md`);
    const inv = await inventory(
      ["docs", ...members.map((m) => `docs/${m}`)],
      members.flatMap((m) => [
        ...shared.map((file) => `docs/${m}/${file}`),
        // A path three members carry is core, but ranks below the twelve every member does.
        ...(m === "d" ? [] : [`docs/${m}/extra.md`]),
      ]),
    );
    const scan = await scanLayout(inv, new Set());
    const core = paths(scan).filter((p) => p.startsWith("docs/{name}/") && p !== "docs/{name}/");
    expect(core.length).toBe(LAYOUT_TUNING.groupCoreCap);
    expect(core).not.toContain("docs/{name}/extra.md");
    expect(scan.notes.join("\n")).toContain(
      `docs/{name}/ members share 5 more paths than the ${LAYOUT_TUNING.groupCoreCap} listed (page08.md, page09.md, page10.md, …)`,
    );
    // The scaffold scanner sees the same cap: no template group for a dropped path.
    expect(scan.templateGroups.map((g) => g.target)).not.toContain("docs/{name}/page11.md");
  });
});
