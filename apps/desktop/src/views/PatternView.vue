<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, type PatternDetail, type ScaffoldReport } from "../api";
import CodeEditor from "../components/CodeEditor.vue";
import FacetChips from "../components/FacetChips.vue";
import PathField from "../components/PathField.vue";
import { renderMarkdown } from "../lib/markdown";
import { toast } from "../lib/toasts";

const props = defineProps<{ name: string }>();

/** A layout longer than this folds; the panel's footer unfolds it. */
const LAYOUT_FOLD = 10;
/** Prose with more extraction notes than this folds the same way. */
const PROSE_FOLD = 3;

const detail = ref<PatternDetail | null>(null);
const loading = ref(true);
const loadError = ref("");
const mode = ref<"read" | "edit">("read");
const buffer = ref("");
const saveError = ref("");
const saving = ref(false);
const showAllLayout = ref(false);
const showAllProse = ref(false);

async function load(): Promise<void> {
  loadError.value = "";
  try {
    const got = await api.getPattern(props.name);
    detail.value = got;
    if (got.error) {
      // A broken pattern opens straight in the editor; fixing it is the visit.
      buffer.value = got.source;
      mode.value = "edit";
    }
  } catch (cause) {
    loadError.value = cause instanceof Error ? cause.message : String(cause);
  }
  loading.value = false;
}

function startEdit(): void {
  buffer.value = detail.value?.source ?? "";
  saveError.value = "";
  mode.value = "edit";
}

function cancelEdit(): void {
  saveError.value = "";
  mode.value = "read";
}

async function save(): Promise<void> {
  saving.value = true;
  saveError.value = "";
  try {
    await api.savePattern(props.name, buffer.value);
    toast("success", `"${props.name}" saved and valid.`);
    await load(); // re-read the saved truth
    mode.value = "read";
  } catch (cause) {
    // A 422 keeps the buffer: same loop as `dolly edit`, nothing lost.
    saveError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving.value = false;
  }
}

const pattern = computed(() => detail.value?.pattern);
const toolRoles = computed(() => {
  const toolchain = pattern.value?.toolchain;
  if (!toolchain) return [];
  const roles = [
    "packageManager",
    "formatter",
    "linter",
    "typechecker",
    "testRunner",
    "taskRunner",
    "ci",
    "hooks",
  ] as const;
  return roles.flatMap((role) => {
    const tool = toolchain[role];
    return tool ? [{ role, tool }] : [];
  });
});
const configs = computed(() => {
  const toolchain = pattern.value?.toolchain;
  return Object.keys(toolchain?.configs ?? {}).map((source) => ({
    source,
    binding: toolchain?.binding?.[source] ?? "subset",
  }));
});
const drifted = computed(() => pattern.value !== undefined && pattern.value.name !== props.name);

interface Cell {
  key: string;
  value: string;
  mono?: boolean;
  dev?: boolean;
}

/** Two cells to a row, the way the boards lay out the short facets. */
function pairs<T>(items: T[]): [T, T | undefined][] {
  const rows: [T, T | undefined][] = [];
  for (let i = 0; i < items.length; i += 2) {
    const left = items[i];
    if (left !== undefined) rows.push([left, items[i + 1]]);
  }
  return rows;
}

const projectCells = computed<Cell[]>(() => {
  const p = pattern.value;
  if (!p) return [];
  const cells: Cell[] = [];
  if (p.license) cells.push({ key: "license", value: p.license });
  if (p.languages?.programming?.length) {
    cells.push({ key: "languages", value: p.languages.programming.join(", ") });
  }
  for (const [runtime, range] of Object.entries(p.languages?.versions ?? {})) {
    cells.push({ key: runtime, value: range, mono: true });
  }
  if (p.languages?.natural) cells.push({ key: "docs language", value: p.languages.natural });
  if (commitsLine.value) cells.push({ key: "commits", value: commitsLine.value });
  if (releasesLine.value) cells.push({ key: "releases", value: releasesLine.value });
  return cells;
});
const roleCells = computed<Cell[]>(() =>
  toolRoles.value.map(({ role, tool }) => ({ key: role, value: tool, mono: true })),
);
/** Runtime dependencies down the left, dev down the right, as on the board; one column when only one kind exists. */
const dependencyRows = computed<(Cell | undefined)[][]>(() => {
  const deps = pattern.value?.dependencies;
  const runtime = Object.entries(deps?.runtime ?? {}).map(
    ([key, value]): Cell => ({ key, value, mono: true }),
  );
  const dev = Object.entries(deps?.dev ?? {}).map(
    ([key, value]): Cell => ({ key, value, mono: true, dev: true }),
  );
  if (runtime.length === 0 || dev.length === 0) return [...runtime, ...dev].map((cell) => [cell]);
  const rows: (Cell | undefined)[][] = [];
  for (let i = 0; i < Math.max(runtime.length, dev.length); i++) rows.push([runtime[i], dev[i]]);
  return rows;
});
const layout = computed(() => pattern.value?.layout ?? []);
const shownLayout = computed(() =>
  showAllLayout.value ? layout.value : layout.value.slice(0, LAYOUT_FOLD),
);
/** The two history facets, each as the one line the pattern view has room for. */
const commitsLine = computed(() => {
  const commits = pattern.value?.commits;
  if (!commits) return "";
  const parts = [commits.style];
  if (commits.types?.length) parts.push(commits.types.join(", "));
  if (commits.scope) parts.push(`scopes ${commits.scope}`);
  if (commits.subject) parts.push(`${commits.subject} case subjects`);
  return parts.join("; ");
});
const releasesLine = computed(() => {
  const releases = pattern.value?.releases;
  if (!releases) return "";
  return [releases.versioning, releases.changelog, releases.tool].filter(Boolean).join("; ");
});

/** The conventions rendered from their markdown, through the renderer that escapes everything first. */
const renderedProse = computed(() => renderMarkdown(detail.value?.prose ?? ""));
const noteCount = computed(() => ((detail.value?.prose ?? "").match(/^\s*[-*+]\s/gm) ?? []).length);
const proseFolded = computed(() => noteCount.value > PROSE_FOLD && !showAllProse.value);

/** The overview exists only for a source that parses; a broken pattern stays in the editor. */
const reading = computed(() => mode.value === "read" && pattern.value !== undefined);

/** `dolly new` from here (M9): an inline panel, the directory picked or typed, the report shown after. */
const scaffolding = ref(false);
const targetDir = ref("");
const scaffoldBusy = ref(false);
const scaffoldError = ref("");
const scaffolded = ref<ScaffoldReport | null>(null);

function openScaffold(): void {
  scaffolding.value = !scaffolding.value;
  scaffolded.value = null;
  scaffoldError.value = "";
}

async function scaffold(): Promise<void> {
  scaffoldBusy.value = true;
  scaffoldError.value = "";
  try {
    scaffolded.value = await api.scaffold(props.name, targetDir.value);
    toast("success", `Scaffolded ${scaffolded.value.created.length} entries into ${scaffolded.value.root}`);
  } catch (cause) {
    scaffoldError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    scaffoldBusy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section>
    <p v-if="loadError" class="error">{{ loadError }}</p>

    <div v-else-if="loading" class="panel" aria-hidden="true">
      <div class="skeleton">
        <div class="skeleton-line" style="width: 30%"></div>
        <div class="skeleton-line" style="width: 70%"></div>
        <div class="skeleton-line" style="width: 55%"></div>
        <div class="skeleton-line" style="width: 63%"></div>
      </div>
    </div>

    <template v-else-if="detail">
      <div class="page-head">
        <div class="sub">
          <div class="title">
            <h1 class="mono">{{ props.name }}</h1>
            <span v-if="pattern?.description" class="note">{{ pattern.description }}</span>
          </div>
          <span v-if="drifted" class="note">
            The frontmatter says "{{ pattern?.name }}", but the pattern stays filed under
            "{{ props.name }}".
          </span>
          <FacetChips :pattern="pattern" />
        </div>
        <div>
          <div class="segmented">
            <button
              type="button"
              :class="{ on: reading }"
              :aria-pressed="reading"
              :disabled="!pattern"
              :title="pattern ? undefined : 'The overview needs a source that parses'"
              @click="reading || cancelEdit()"
            >
              Overview
            </button>
            <button type="button" :class="{ on: !reading }" :aria-pressed="!reading" @click="reading && startEdit()">
              Source
            </button>
          </div>
          <button v-if="reading && pattern" class="primary" type="button" :aria-pressed="scaffolding" @click="openScaffold">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            New project
          </button>
          <a v-if="reading && pattern" class="button" :href="`#/export/${encodeURIComponent(name)}`">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 15V4" />
              <path d="m8 8 4-4 4 4" />
              <path d="M4.5 14.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
            </svg>
            Export
          </a>
          <button v-if="reading" type="button" @click="startEdit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
              <path d="m13.5 8.5 3 3" />
            </svg>
            Edit
          </button>
        </div>
      </div>

      <form v-if="reading && pattern && scaffolding" class="panel flow" @submit.prevent="scaffold">
        <div class="panel-head">
          <h3>New project from {{ props.name }}</h3>
          <span class="count">the same scaffold as <code>dolly new</code>: layout, configs, templates, the manifest, LICENSE, git init, and the .dolly marker</span>
        </div>
        <div class="panel-body stack">
          <div class="toolbar bare">
            <PathField v-model="targetDir" kind="directory" name="new-dir" placeholder="/path/to/new-project" title="Choose where to scaffold" />
            <button class="primary" type="submit" :disabled="scaffoldBusy || !targetDir">Scaffold</button>
            <button class="ghost" type="button" @click="scaffolding = false">{{ scaffolded ? "Done" : "Cancel" }}</button>
          </div>
          <p v-if="scaffoldError" class="error">{{ scaffoldError }}</p>
          <div v-else-if="scaffolded" class="facts">
            <span><strong>{{ scaffolded.created.length }} entries</strong> <span class="muted">written into {{ scaffolded.root }}.</span></span>
            <span v-if="scaffolded.skipped.length" class="muted">Skipped per-resource paths (their {name} names a module you add later): {{ scaffolded.skipped.join(", ") }}.</span>
            <span v-for="note in scaffolded.notes" :key="note" class="muted">{{ note }}</span>
            <span v-for="step in scaffolded.nextSteps" :key="step"><code>{{ step }}</code></span>
          </div>
          <span v-else class="note">The directory's name becomes the project's. It must be empty or not exist yet; nothing is ever written over.</span>
        </div>
      </form>

      <div v-if="reading && pattern" class="two-up">
        <div class="stack">
          <div v-if="projectCells.length" class="panel">
            <div class="panel-head"><h3>Project</h3></div>
            <table class="kv">
              <tbody>
                <tr v-for="[left, right] in pairs(projectCells)" :key="left.key">
                  <td class="k">{{ left.key }}</td>
                  <td><span :class="{ mono: left.mono }">{{ left.value }}</span></td>
                  <td class="k">{{ right?.key }}</td>
                  <td><span v-if="right" :class="{ mono: right.mono }">{{ right.value }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="toolRoles.length || configs.length" class="panel">
            <div class="panel-head">
              <h3>Toolchain</h3>
              <span v-if="configs.length" class="count">
                {{ configs.length }} {{ configs.length === 1 ? "config" : "configs" }} captured
              </span>
            </div>
            <table v-if="roleCells.length" class="kv">
              <tbody>
                <tr v-for="[left, right] in pairs(roleCells)" :key="left.key">
                  <td class="k">{{ left.key }}</td>
                  <td><span class="mono">{{ left.value }}</span></td>
                  <td class="k">{{ right?.key }}</td>
                  <td><span v-if="right" class="mono">{{ right.value }}</span></td>
                </tr>
              </tbody>
            </table>
            <table v-if="configs.length" class="kv">
              <tbody>
                <tr v-for="{ source, binding } in configs" :key="source">
                  <td class="k"><span class="mono">{{ source }}</span></td>
                  <td>
                    <span class="badge">captured</span>
                    <span class="badge">{{ binding }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="pattern.commands" class="panel">
            <div class="panel-head"><h3>Commands</h3></div>
            <table class="kv">
              <tbody>
                <tr v-for="(command, verb) in pattern.commands" :key="verb">
                  <td class="k"><span class="mono">{{ verb }}</span></td>
                  <td><span class="mono">{{ command }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="detail.prose" class="panel">
            <div class="panel-head">
              <h3>Conventions</h3>
              <span v-if="noteCount" class="count">{{ noteCount }} extraction note{{ noteCount === 1 ? "" : "s" }}</span>
            </div>
            <div class="prose" :class="{ folded: proseFolded }" v-html="renderedProse"></div>
            <div v-if="noteCount > PROSE_FOLD" class="panel-body">
              <button class="ghost small" type="button" @click="showAllProse = !showAllProse">
                {{ showAllProse ? "Show fewer" : `Show all ${noteCount} notes` }}
              </button>
            </div>
          </div>
        </div>

        <div class="stack">
          <div v-if="layout.length" class="panel">
            <div class="panel-head">
              <h3>Layout</h3>
              <span class="count">{{ layout.length }} {{ layout.length === 1 ? "path" : "paths" }}</span>
            </div>
            <ul class="paths">
              <li v-for="entry in shownLayout" :key="entry.path">
                <span>{{ entry.path }}</span>
                <span v-if="entry.description || entry.required" class="note">
                  {{ entry.description }}
                  <span v-if="entry.required" class="badge">required</span>
                </span>
              </li>
            </ul>
            <div v-if="layout.length > LAYOUT_FOLD" class="panel-body">
              <button class="ghost small" type="button" @click="showAllLayout = !showAllLayout">
                {{ showAllLayout ? `Show first ${LAYOUT_FOLD}` : `Show all ${layout.length}` }}
              </button>
            </div>
          </div>

          <div v-if="pattern.naming || pattern.testing" class="two-up">
            <div v-if="pattern.naming" class="panel">
              <div class="panel-head"><h3>Naming</h3></div>
              <table class="kv">
                <tbody>
                  <tr v-if="pattern.naming.files">
                    <td class="k">files</td>
                    <td><span class="mono">{{ pattern.naming.files }}</span></td>
                  </tr>
                  <tr v-if="pattern.naming.directories">
                    <td class="k">directories</td>
                    <td><span class="mono">{{ pattern.naming.directories }}</span></td>
                  </tr>
                  <tr v-for="(style, extension) in pattern.naming.extensions" :key="extension">
                    <td class="k"><span class="mono">{{ extension }}</span></td>
                    <td><span class="mono">{{ style }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="pattern.testing" class="panel">
              <div class="panel-head"><h3>Testing</h3></div>
              <table class="kv">
                <tbody>
                  <tr v-if="pattern.testing.placement">
                    <td class="k">placement</td>
                    <td>{{ pattern.testing.placement }}</td>
                  </tr>
                  <tr v-if="pattern.testing.filePattern">
                    <td class="k">file pattern</td>
                    <td><span class="mono">{{ pattern.testing.filePattern }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="pattern.dependencies?.runtime || pattern.dependencies?.dev" class="panel">
            <div class="panel-head">
              <h3>Dependencies</h3>
              <span v-if="pattern.dependencies?.versionPolicy" class="count">
                version policy: {{ pattern.dependencies.versionPolicy }}
              </span>
            </div>
            <table class="kv">
              <tbody>
                <tr v-for="(cells, index) in dependencyRows" :key="index">
                  <template v-for="(cell, at) in cells" :key="at">
                    <td class="k">{{ cell?.key }}</td>
                    <td>
                      <template v-if="cell">
                        <span class="mono">{{ cell.value }}</span>
                        <span v-if="cell.dev" class="badge">dev</span>
                      </template>
                    </td>
                  </template>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="pattern.scaffold?.templates?.length" class="panel">
            <div class="panel-head"><h3>Templates</h3></div>
            <ul class="paths">
              <li v-for="template in pattern.scaffold.templates" :key="template">
                <span>{{ template }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <template v-else>
        <p v-if="detail.error" class="error">{{ detail.error }}</p>
        <p v-if="saveError" class="error">{{ saveError }}</p>
        <CodeEditor v-model="buffer" />
        <div class="actions-row" style="margin-top: 10px">
          <button class="primary" type="button" :disabled="saving" @click="save">Save</button>
          <button type="button" :disabled="saving" @click="cancelEdit">Cancel</button>
          <span class="muted">Validated on save. An invalid pattern is never written.</span>
        </div>
      </template>
    </template>
  </section>
</template>
