import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What every spec runs against: a temporary DOLLY_HOME holding one pattern
 * extracted from a small fixture project, two copies of that project each
 * missing its README (one fixable violation for check and one for fit,
 * kept apart so the specs never see each other's edits), and `dolly serve`
 * on an ephemeral port over that home. The specs find it all through
 * DOLLY_E2E, set here before the workers start; the teardown stops the
 * daemon and removes the home.
 */
export interface Seed {
  /** The daemon's URL, the token in its fragment. */
  url: string;
  home: string;
  /** The project the pattern was extracted from. */
  fixture: string;
  /** Its copy for the check spec, README.md removed. */
  checked: string;
  /** Its copy for the fit spec, README.md removed. */
  fitted: string;
}

const desktop = fileURLToPath(new URL("..", import.meta.url));
const cli = resolve(desktop, "..", "..", "packages", "cli", "src", "main.ts");

const FIXTURE: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name: "fixture",
      version: "1.0.0",
      license: "MIT",
      scripts: { test: "bun test", lint: "biome check ." },
      devDependencies: { "@biomejs/biome": "^2.0.0" },
    },
    null,
    2,
  ),
  "biome.json": JSON.stringify({ formatter: { enabled: true }, linter: { enabled: true } }),
  "README.md": "# fixture\n",
  LICENSE: "MIT License\n\nCopyright (c) 2026 Someone\n",
  ".gitignore": "node_modules/\n",
  "src/index.ts": "export {};\n",
  "src/other-thing.ts": "export {};\n",
  "test/index.test.ts": "",
};

export default async function setup(): Promise<() => Promise<void>> {
  if (!existsSync(join(desktop, "dist", "index.html"))) {
    throw new Error("The webview is not built; run `bun run build` in apps/desktop first.");
  }
  const home = await mkdtemp(join(tmpdir(), "dolly-e2e-"));
  const fixture = join(home, "fixture");
  for (const [path, contents] of Object.entries(FIXTURE)) {
    await mkdir(dirname(join(fixture, path)), { recursive: true });
    await writeFile(join(fixture, path), contents);
  }
  await dolly(home, ["extract", fixture, "--name", "fixture"]);
  const copies = { checked: join(home, "checked"), fitted: join(home, "fitted") };
  for (const dir of Object.values(copies)) {
    await cp(fixture, dir, { recursive: true });
    await rm(join(dir, "README.md"));
    await writeFile(join(dir, ".dolly"), "pattern: fixture\n");
  }
  const daemon = spawn("bun", [cli, "serve", "--port", "0"], {
    env: { ...process.env, DOLLY_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await servingUrl(daemon);
  const seed: Seed = { url, home, fixture, ...copies };
  process.env.DOLLY_E2E = JSON.stringify(seed);
  return async () => {
    daemon.kill();
    await rm(home, { recursive: true, force: true });
  };
}

/** One CLI run over the seeded home; its failure is the setup's. */
function dolly(home: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", [cli, ...args], {
      env: { ...process.env, DOLLY_HOME: home },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`dolly ${args[0]} failed: ${stderr}`)),
    );
  });
}

/** The URL the daemon prints once it listens, or the reason it did not. */
function servingUrl(daemon: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    daemon.stdout?.on("data", (chunk) => {
      output += chunk;
      const url = output.match(/dolly is serving at (\S+)/)?.[1];
      if (url) resolve(url);
    });
    daemon.stderr?.on("data", (chunk) => {
      output += chunk;
    });
    daemon.on("exit", (code) => reject(new Error(`dolly serve exited with ${code}: ${output}`)));
  });
}
