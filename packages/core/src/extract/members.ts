import type { Toolchain } from "../pattern/schema";
import { type Inventory, rootFiles, subInventory } from "../tree/inventory";
import { type Ecosystem, ecosystemOf, isManifestName } from "./registry";
import { scanToolchain } from "./toolchain";

/**
 * A repository without a root manifest (a tree of samples, a monorepo whose
 * members carry their own) says nothing about its toolchain at the root,
 * and read there it scaffolds whatever language dominates by bytes. The
 * members do say: each first-level directory carrying a manifest is scanned
 * on its own, and for each role the tool a majority of them share becomes
 * the facet, the members that disagree named in the notes, the way several
 * repositories agree on one pattern. The primary ecosystem follows the same
 * vote. Only roles travel: a member's captured config lives under the
 * member, where a root pattern's config rule would never find it.
 */
export interface MembersScan {
  primary?: Ecosystem;
  toolchain?: Toolchain;
  notes: string[];
}

const ROLES = [
  "packageManager",
  "formatter",
  "linter",
  "typechecker",
  "testRunner",
  "taskRunner",
] as const;

export async function scanMembers(inventory: Inventory): Promise<MembersScan | undefined> {
  if ([...rootFiles(inventory)].some(isManifestName)) return undefined; // the root speaks for itself
  const members = inventory.dirs
    .filter((dir) => !dir.includes("/") && !dir.startsWith("."))
    .map((dir) => ({ name: dir, inventory: subInventory(inventory, dir) }))
    .filter((member) => [...rootFiles(member.inventory)].some(isManifestName));
  if (members.length < 2) return undefined;

  const scans = await Promise.all(
    members.map(async ({ name, inventory: sub }) => {
      // A member's ecosystem is its manifest's; the tree's languages are voted once, at the root.
      const primary = ecosystemOf([], rootFiles(sub));
      return { name, primary, toolchain: (await scanToolchain(sub, primary)).toolchain };
    }),
  );
  const names = scans.map((scan) => scan.name);
  const notes = [
    `No manifest at the root, so the toolchain is what a majority of the ${scans.length} members carrying one agree on (${names.slice(0, 4).join(", ")}${names.length > 4 ? ", …" : ""}).`,
  ];
  const majority = Math.floor(scans.length / 2) + 1;

  /** The value a majority of the members say, the others named; unset with the tally when none reaches it. */
  const vote = (label: string, said: { member: string; value: string | undefined }[]) => {
    const carriers = said.filter(
      (s): s is { member: string; value: string } => s.value !== undefined,
    );
    const tally = [...new Set(carriers.map((s) => s.value))]
      .map((value) => ({ value, count: carriers.filter((s) => s.value === value).length }))
      .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));
    const top = tally[0];
    if (!top) return undefined;
    if (top.count < majority) {
      notes.push(
        `${label} left unset: ${tally.map((t) => `${t.count} say ${t.value}`).join(", ")} of ${scans.length} members.`,
      );
      return undefined;
    }
    const others = carriers.filter((s) => s.value !== top.value);
    if (others.length > 0) {
      notes.push(
        `${label}: ${top.value} (${top.count} of ${scans.length} members); ${others.map((o) => `${o.member} says ${o.value}`).join(", ")}.`,
      );
    }
    return top.value;
  };

  const primary = vote(
    "ecosystem",
    scans.map((s) => ({ member: s.name, value: s.primary })),
  ) as Ecosystem | undefined;
  const toolchain: Toolchain = { configs: {}, binding: {} };
  for (const role of ROLES) {
    const winner = vote(
      role,
      scans.map((s) => ({ member: s.name, value: s.toolchain?.[role] })),
    );
    if (winner) toolchain[role] = winner;
  }
  return {
    ...(primary ? { primary } : {}),
    ...(ROLES.some((role) => toolchain[role]) ? { toolchain } : {}),
    notes,
  };
}
