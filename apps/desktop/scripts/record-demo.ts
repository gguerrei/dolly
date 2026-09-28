import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { serveDolly } from "../../../packages/cli/src/serve";
import { PatternStore } from "../../../packages/core/src/store";

// Commands run against a temporary clone. Their actual output is displayed
// with reading pauses, then the recording opens the running local GUI.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = resolve(process.argv[2] ?? join(root, "assets"));
const scratch = await mkdtemp(join(tmpdir(), "dolly-demo-"));
const project = join(scratch, "dolly");
const home = join(scratch, "store");
const cli = join(root, "packages/cli/src/main.ts");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const pattern = "dolly-style";
const capture: { command: string; stdout: string; stderr: string; exitCode: number }[] = [];
process.env.DOLLY_HOME = home;

async function run(command: string[], cwd = project, expected = 0): Promise<string> {
  const child = Bun.spawn(command, {
    cwd,
    env: { ...process.env, DOLLY_HOME: home, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== expected) {
    throw new Error(
      `${command.join(" ")} exited ${exitCode}, expected ${expected}\n${stderr}\n${stdout}`,
    );
  }
  capture.push({ command: command.join(" "), stdout, stderr, exitCode });
  return stdout.trimEnd();
}

await run([ffmpeg, "-version"], root);
await mkdir(output, { recursive: true });
await run(["git", "clone", "--quiet", "--no-hardlinks", root, project], root);
const revision = await run(["git", "rev-parse", "HEAD"]);
const logo = Buffer.from(await readFile(join(root, "assets/logo.svg"))).toString("base64");
const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>dolly demo</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; padding: 38px 48px; background: #fafafa; color: #1c1c1c;
  font-family: "DejaVu Sans", sans-serif; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
.brand { display: flex; align-items: center; gap: 12px; font-size: 25px; font-weight: 700; }
.brand img { width: 57px; }
.local { font-size: 16px; color: #6b6b6b; }
h1 { font-size: 32px; font-weight: 600; letter-spacing: -0.7px; margin: 0 0 24px; }
.terminal { height: 536px; border-radius: 12px; overflow: hidden; background: #1c1c1c;
  color: #ededed; border: 1px solid #333; }
.bar { padding: 13px 24px; border-bottom: 1px solid #424242; color: #aaa;
  font-family: "DejaVu Sans Mono", monospace; font-size: 16px; }
.body { padding: 26px 28px; }
pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere;
  font: 20px/1.55 "DejaVu Sans Mono", monospace; }
#command { margin-bottom: 22px; color: white; }
#output { color: #d7d7d7; }
.file #output { font-size: 19px; line-height: 1.5; }
.file #command { display: none; }
.failed #output { color: #e9bd77; }
footer { display: flex; justify-content: space-between; gap: 24px;
  margin-top: 22px; font-size: 17px; color: #6b6b6b; line-height: 1.5; }
footer span:last-child { white-space: nowrap; }
</style>
<header><div class="brand"><img alt="" src="data:image/svg+xml;base64,${logo}">dolly</div>
<span class="local">Local extraction · No API key</span></header>
<h1 id="title"></h1>
<section class="terminal"><div class="bar" id="bar">dolly / terminal</div>
<div class="body"><pre id="command"></pre><pre id="output"></pre></div></section>
<footer><span id="caption"></span><span>github.com/gguerrei/dolly</span></footer>
</html>`;

const server = await serveDolly({ port: 0, store: new PatternStore(join(home, "patterns")) });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  colorScheme: "light",
  reducedMotion: "reduce",
  recordVideo: { dir: join(scratch, "video"), size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const video = page.video();
if (!video) throw new Error("The browser did not start a recording.");

async function scene(title: string, caption: string, kind = "", bar = "dolly / terminal") {
  await page.setContent(html);
  await page.evaluate(
    ({ title, caption, kind, bar }) => {
      const required = (id: string) => {
        const element = document.getElementById(id);
        if (!element) throw new Error(`Missing recording element: ${id}`);
        return element;
      };
      required("title").textContent = title;
      required("caption").textContent = caption;
      required("bar").textContent = bar;
      document.body.className = kind;
    },
    { title, caption, kind, bar },
  );
}

async function showOutput(value: string) {
  await page.locator("#output").evaluate((element, text) => {
    element.textContent = text;
  }, value);
  const fits = await page.locator(".body").evaluate((element) => {
    const frame = element.parentElement;
    return (
      frame !== null &&
      element.getBoundingClientRect().bottom <= frame.getBoundingClientRect().bottom
    );
  });
  if (!fits) throw new Error("The terminal output extends beyond the recording frame.");
}

async function command(args: string[], hold: number, expected = 0) {
  const text = `dolly ${args.join(" ")}`;
  for (let index = 0; index <= text.length; index += 3) {
    await page.locator("#command").evaluate(
      (element, value) => {
        element.textContent = value;
      },
      `$ ${text.slice(0, index)}`,
    );
    await page.waitForTimeout(35);
  }
  await page.locator("#command").evaluate((element, value) => {
    element.textContent = value;
  }, `$ ${text}`);
  const result = await run([process.execPath, cli, ...args], project, expected);
  await showOutput(result);
  await page.waitForTimeout(hold);
  return result;
}

try {
  await scene("Extract conventions from an existing repo", "This run uses Dolly's own repository.");
  await command(["extract", ".", "--name", pattern], 4700);
  await page.screenshot({ path: join(scratch, "01-extract.png") });

  await scene(
    "Export instructions for your coding agent",
    "The same pattern can also produce CLAUDE.md and Cursor rules.",
  );
  await command(["export", pattern, "--as", "agents-md"], 2600);
  const instructions = await readFile(join(project, "AGENTS.md"), "utf8");
  const start = instructions.indexOf("## Testing\n");
  const end = instructions.indexOf("## License\n", start);
  if (start < 0 || end < 0)
    throw new Error("The expected instruction sections were not extracted.");
  await scene(
    "Read the conventions Dolly found",
    "An excerpt from the generated file, ready to review.",
    "file",
    "AGENTS.md / Testing and Commands",
  );
  await showOutput(instructions.slice(start, end).trim());
  await page.screenshot({ path: join(scratch, "02-instructions.png") });
  await page.waitForTimeout(6800);

  await scene(
    "Check the project against its pattern",
    "The repository passes its own conventions.",
  );
  await command(["check", pattern], 3400);

  const manifestPath = join(project, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.scripts.test = "bun test --coverage";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await scene("Change the project's test command", "The recorded pattern still expects bun test.");
  await page.locator("#command").evaluate((element) => {
    element.textContent = "$ git diff --unified=1 -- package.json";
  });
  await showOutput(await run(["git", "diff", "--unified=1", "--", "package.json"]));
  await page.waitForTimeout(4800);

  await scene("Catch the drift", "Exit status 1 lets the same check fail a CI job.", "failed");
  await command(["check", pattern], 6000, 1);
  await page.screenshot({ path: join(scratch, "03-drift.png") });

  await scene(
    "Restore the pattern's command",
    "The fix updates the test script and preserves unrelated settings.",
  );
  await command(["check", pattern, "--fix"], 4500);
  const restored = JSON.parse(await readFile(manifestPath, "utf8"));
  if (restored.scripts.test !== "bun test") throw new Error("The test command was not restored.");
  if ((await run(["git", "diff", "--", "package.json"])) !== "") {
    throw new Error("The fix changed other manifest content.");
  }

  await page.goto(server.url);
  await page.goto(`${server.url.split("#")[0]}#/export/${pattern}`);
  await page.getByPlaceholder("/path/to/project").fill(project);
  await expect(page.locator(".preview")).toContainText("## Commands");
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".preview").evaluate((element) => {
    const index = element.textContent?.indexOf("## Toolchain\n") ?? -1;
    if (index < 0) throw new Error("The GUI did not render the toolchain.");
    const lines = (element.textContent ?? "").slice(0, index).split("\n").length - 1;
    element.scrollTop = lines * Number.parseFloat(getComputedStyle(element).lineHeight);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(output, "gui.png") });
  await page.waitForTimeout(5000);
  if (errors.length) throw new Error(`The GUI logged errors: ${errors.join("\n")}`);
} finally {
  await context.close();
  await browser.close();
  server.stop();
  await writeFile(
    join(scratch, "capture.json"),
    `${JSON.stringify({ revision, capture }, null, 2)}\n`,
  );
}

const mp4 = join(output, "demo.mp4");
const gif = join(output, "demo.gif");
await run([
  ffmpeg,
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  await video.path(),
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  "-map_metadata",
  "-1",
  mp4,
]);
await run([
  ffmpeg,
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  mp4,
  "-filter_complex",
  "fps=6,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
  "-loop",
  "0",
  gif,
]);
console.log(`Wrote ${mp4}, ${gif}, and ${join(output, "gui.png")}`);
console.log(`Captured commands, exit codes, and still frames: ${scratch}`);
