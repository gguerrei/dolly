import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { licenseSchema } from "../pattern/schema";
import { type Inventory, rootFiles } from "../tree/inventory";

/**
 * Detects the project license as an SPDX id: manifest fields first (the
 * author's own declaration), the LICENSE file's text as a fallback. When the
 * two disagree, no facet is emitted: a wrong license is worse than none.
 */

export interface LicenseScan {
  license?: string;
  notes: string[];
}

/**
 * A license file's name: LICENSE, LICENCE, or COPYING, with any extension, or
 * with the suffix a dual-licensed crate uses (LICENSE-MIT, LICENSE-APACHE).
 */
export const LICENSE_FILE = /^(licen[cs]e|copying)($|[.\-_])/i;

/** The repo's license file, when the inventory can see one at the root. */
export function findLicenseFile(inventory: Inventory): string | undefined {
  return inventory.files.find((f) => !f.path.includes("/") && LICENSE_FILE.test(f.path))?.path;
}

export async function scanLicense(inventory: Inventory): Promise<LicenseScan> {
  const notes: string[] = [];
  const declared = await declaredLicenses(inventory, notes);
  const licenseFile = findLicenseFile(inventory);
  const fingerprint = licenseFile ? await fingerprintFile(inventory, licenseFile) : undefined;

  if (declared.ids.length > 1) {
    notes.push(
      `Manifests disagree on the license (${declared.ids.sort().join(" vs ")}); no facet emitted.`,
    );
    return { notes };
  }

  const manifestId = declared.ids[0];
  if (manifestId) {
    // An expression like "(MIT OR Apache-2.0)" agrees with a LICENSE file
    // carrying any one of its ids, so compare against each, not the whole.
    const inManifest = (id: string) => spdxIds(manifestId).includes(id);
    const textIds = fingerprint?.id ? [fingerprint.id] : (fingerprint?.candidates ?? []);
    if (textIds.length > 0 && !textIds.some(inManifest)) {
      notes.push(
        `The manifest says ${manifestId} but ${licenseFile} reads like ${textIds.join(" or ")}; no facet emitted, so fix whichever is wrong.`,
      );
      return { notes };
    }
    return { license: manifestId, notes };
  }

  if (declared.declaredSomething) {
    // The author declared a license dolly could not use (UNLICENSED, a value
    // it does not recognize), and a stray LICENSE file must not overrule that.
    if (fingerprint?.id) {
      notes.push(
        `${licenseFile} reads like ${fingerprint.id}, but the manifest's own declaration is what counts. Set the license facet by hand if the text is right.`,
      );
    }
    return { notes };
  }

  if (fingerprint?.id) return { license: fingerprint.id, notes };
  if (fingerprint?.note) notes.push(fingerprint.note);
  return { notes };
}

interface DeclaredLicenses {
  ids: string[];
  /** True when any manifest declared a value at all, usable as a facet or not. */
  declaredSomething: boolean;
}

/** One declared id per manifest, deduped, since most repos declare in one place. */
async function declaredLicenses(inventory: Inventory, notes: string[]): Promise<DeclaredLicenses> {
  const ids = new Set<string>();
  let declaredSomething = false;
  const atRoot = rootFiles(inventory);
  const read = (name: string) => Bun.file(join(inventory.root, name)).text();

  const addDeclared = (source: string, raw: string | undefined) => {
    const value = raw?.trim();
    if (!value) return;
    declaredSomething = true;
    const id = validSpdx(raw);
    if (id) {
      ids.add(id);
      return;
    }
    if (/^UNLICENSED$/i.test(value)) {
      notes.push(`${source} marks the project UNLICENSED (proprietary); no license facet.`);
      return;
    }
    notes.push(
      `${source} declares the license as "${value}", which dolly does not recognize as an SPDX id. Set the license facet by hand.`,
    );
  };

  if (atRoot.has("package.json")) {
    try {
      const manifest = JSON.parse(await read("package.json")) as {
        license?: string | { type?: string };
      };
      addDeclared(
        "package.json",
        typeof manifest.license === "string" ? manifest.license : manifest.license?.type,
      );
    } catch {
      // An unparseable manifest already cost its own facets elsewhere.
    }
  }

  if (atRoot.has("pyproject.toml")) {
    try {
      const project = (parseToml(await read("pyproject.toml")) as Record<string, unknown>)
        .project as { license?: string | { text?: string; file?: string } } | undefined;
      addDeclared(
        "pyproject.toml",
        typeof project?.license === "string" ? project.license : project?.license?.text,
      );
    } catch {
      // Same: parse failures degrade silently here, noted by other scanners.
    }
  }

  if (atRoot.has("Cargo.toml")) {
    try {
      const pkg = (parseToml(await read("Cargo.toml")) as Record<string, unknown>).package as
        | { license?: string }
        | undefined;
      addDeclared("Cargo.toml", pkg?.license);
    } catch {
      // Ditto.
    }
  }

  return { ids: [...ids], declaredSomething };
}

/**
 * The ids extraction will vouch for. Deliberately short: the schema accepts
 * the whole SPDX grammar for hand-written patterns, but inference only writes
 * a facet for an id it recognizes; anything else degrades to a note.
 */
const KNOWN_SPDX = new Set([
  "0BSD",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "Artistic-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "EPL-2.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "ISC",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "NCSA",
  "OFL-1.1",
  "PostgreSQL",
  "Python-2.0",
  "Unlicense",
  "Zlib",
]);

/** The bare ids inside an SPDX value, expression operators and parens dropped. */
export function spdxIds(value: string): string[] {
  return value.split(/\s+(?:AND|OR|WITH)\s+/i).map((id) => id.replace(/[()]/g, "").trim());
}

/** A declared value counts only when every id in it is one dolly knows. */
function validSpdx(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value || value.length > 64 || /\n/.test(value)) return undefined;
  if (!licenseSchema.safeParse(value).success) return undefined;
  return spdxIds(value).every((id) => KNOWN_SPDX.has(id)) ? value : undefined;
}

export interface Fingerprint {
  id?: string;
  /** Ids the text could be when it cannot pin one; a manifest disambiguates. */
  candidates?: string[];
  note?: string;
}

/**
 * Recognizes the handful of license texts that dominate open source. The GPL
 * family degrades to a note: its text cannot say "-only" vs "-or-later".
 */
export async function fingerprintFile(inventory: Inventory, path: string): Promise<Fingerprint> {
  const text = (await Bun.file(join(inventory.root, path)).text()).slice(0, 4096);
  // Clause checks run against whitespace-flattened text: canonical license
  // files line-wrap mid-clause ("included in\nall copies"), and a wrap must
  // never flip a recognition. Title checks stay on the raw text because they
  // are line-anchored on purpose.
  const flat = text.replace(/\s+/g, " ");

  const gpl = text.match(/GNU (AFFERO|LESSER)? ?GENERAL PUBLIC LICENSE\s+Version (\d+(?:\.\d+)?)/i);
  if (gpl) {
    const family = gpl[1]?.toUpperCase() === "AFFERO" ? "AGPL" : gpl[1] ? "LGPL" : "GPL";
    const version = (gpl[2] as string).includes(".") ? (gpl[2] as string) : `${gpl[2]}.0`;
    return {
      candidates: [`${family}-${version}-only`, `${family}-${version}-or-later`],
      note: `${path} contains the ${family}-${version} text, which cannot distinguish "-only" from "-or-later". Set the license facet by hand.`,
    };
  }
  if (/Apache License/i.test(text) && /Version 2\.0/i.test(text)) return { id: "Apache-2.0" };
  if (/Mozilla Public License Version 2\.0/i.test(text)) return { id: "MPL-2.0" };
  if (/This is free and unencumbered software/i.test(text)) return { id: "Unlicense" };
  if (/Permission to use, copy, modify/i.test(flat)) {
    // The notice-retention clause is what separates ISC from 0BSD's text.
    if (/provided that the above copyright notice/i.test(flat)) return { id: "ISC" };
    return {
      candidates: ["0BSD"],
      note: `${path} reads like the 0BSD/ISC family without ISC's notice-retention clause. Set the license facet by hand.`,
    };
  }
  // The title names the license outright ("MIT License", "The MIT License
  // (MIT)"); MIT-0 is titled "MIT No Attribution".
  if (/^(?:The )?MIT License/im.test(text)) return { id: "MIT" };
  if (/Permission is hereby granted, free of charge/i.test(flat)) {
    // MIT-0 is MIT with the notice-retention clause removed, the same trap
    // 0BSD sets for ISC above, so the clause has to be present, not assumed.
    if (/shall be included in all/i.test(flat)) return { id: "MIT" };
    return {
      candidates: ["MIT-0"],
      note: `${path} carries the MIT grant without its notice-retention clause, which is how MIT-0 reads. Set the license facet by hand.`,
    };
  }
  if (/Redistribution and use in source and binary forms/i.test(flat)) {
    if (/All advertising materials/i.test(flat)) {
      return {
        candidates: ["BSD-4-Clause"],
        note: `${path} looks like the 4-clause BSD license. Set the license facet by hand.`,
      };
    }
    return { id: /Neither the name/i.test(flat) ? "BSD-3-Clause" : "BSD-2-Clause" };
  }
  return {
    note: `${path} exists but its text was not recognized. Set the license facet by hand.`,
  };
}
