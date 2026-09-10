import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { type Inventory, rootFiles } from "../tree/inventory";

/**
 * The source project's own identity, which no pattern may carry into an
 * unrelated project: the npm scope its members are published under, and
 * the project's name as its manifest declares it. The layout vote drops
 * paths that carry the name, and the template capture refuses files that do.
 */
export interface ProjectIdentity {
  /** The npm scope (`acme` for `@acme/api`), or the bare package name. */
  scope?: string;
  /** The name to refuse: the scope when there is one, else the manifest's name. */
  name?: string;
}

export async function projectIdentity(inventory: Inventory): Promise<ProjectIdentity> {
  const scope = await packageScope(inventory);
  const name = scope ?? (await manifestProjectName(inventory));
  return { ...(scope ? { scope } : {}), ...(name ? { name } : {}) };
}

/** The npm scope members are published under, from the root manifest's name. */
async function packageScope(inventory: Inventory): Promise<string | undefined> {
  try {
    const { name } = JSON.parse(await Bun.file(join(inventory.root, "package.json")).text()) as {
      name?: string;
    };
    if (typeof name !== "string" || name === "") return undefined;
    return name.startsWith("@") ? (name.slice(1).split("/")[0] as string) : name;
  } catch {
    return undefined;
  }
}

/**
 * The project's name outside npm: Cargo.toml, pyproject.toml, go.mod, a
 * gemspec, pom.xml or the Gradle settings, composer.json, a solution or
 * project file.
 */
async function manifestProjectName(inventory: Inventory): Promise<string | undefined> {
  const atRoot = rootFiles(inventory);
  const read = (name: string) => Bun.file(join(inventory.root, name)).text();
  const first = (text: string, pattern: RegExp) => text.match(pattern)?.[1] || undefined;
  try {
    if (atRoot.has("Cargo.toml")) {
      const pkg = (parseToml(await read("Cargo.toml")) as Record<string, unknown>).package as
        | { name?: string }
        | undefined;
      if (typeof pkg?.name === "string" && pkg.name !== "") return pkg.name;
    }
    if (atRoot.has("pyproject.toml")) {
      const project = (parseToml(await read("pyproject.toml")) as Record<string, unknown>)
        .project as { name?: string } | undefined;
      if (typeof project?.name === "string" && project.name !== "") return project.name;
    }
    if (atRoot.has("go.mod")) {
      const module = (await read("go.mod")).match(/^module\s+(\S+)/m)?.[1];
      if (module) return module.split("/").pop();
    }
    const gemspec = [...atRoot].find((file) => file.endsWith(".gemspec"));
    if (gemspec) return first(await read(gemspec), /\.name\s*=\s*["']([^"']+)["']/);
    if (atRoot.has("pom.xml")) {
      // The project's own artifactId, not its parent's.
      const own = (await read("pom.xml")).replace(/<parent>[\s\S]*?<\/parent>/, "");
      return first(own, /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/);
    }
    for (const settings of ["settings.gradle.kts", "settings.gradle"]) {
      if (atRoot.has(settings)) {
        return first(await read(settings), /rootProject\.name\s*=\s*["']([^"']+)["']/);
      }
    }
    if (atRoot.has("composer.json")) {
      const { name } = JSON.parse(await read("composer.json")) as { name?: string };
      if (typeof name === "string" && name !== "") return name.split("/").pop();
    }
    const dotnet = [...atRoot].find((file) => /\.(slnx?|csproj)$/.test(file));
    if (dotnet) return dotnet.replace(/\.(slnx?|csproj)$/, "");
  } catch {
    // A manifest that will not parse already cost its own facets elsewhere.
  }
  return undefined;
}
