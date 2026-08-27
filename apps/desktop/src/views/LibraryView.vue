<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, ApiError, type Pattern, type PatternSummary } from "../api";
import FacetChips from "../components/FacetChips.vue";
import PathField from "../components/PathField.vue";
import { toast } from "../lib/toasts";

const patterns = ref<PatternSummary[]>([]);
const home = ref("");
const facets = ref<Record<string, Pattern>>({});
const error = ref("");
const loading = ref(true);

async function load(): Promise<void> {
  error.value = "";
  try {
    patterns.value = await api.listPatterns();
    home.value = (await api.health()).home;
    // Summaries carry no facets; fetch details for the chips, tolerating
    // stragglers, since a row without chips beats a library that won't load.
    const details = await Promise.allSettled(
      patterns.value.filter((p) => !p.error).map((p) => api.getPattern(p.name)),
    );
    const byName: Record<string, Pattern> = {};
    for (const result of details) {
      if (result.status === "fulfilled" && result.value.pattern) {
        byName[result.value.name] = result.value.pattern;
      }
    }
    facets.value = byName;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
  loading.value = false;
}

async function remove(name: string): Promise<void> {
  if (!confirm(`Delete pattern "${name}"? Its directory and captured files go with it.`)) return;
  try {
    await api.deletePattern(name);
    toast("success", `Deleted "${name}".`);
    await load();
  } catch (cause) {
    toast("error", cause instanceof Error ? cause.message : String(cause));
  }
}

/**
 * The two ways a pattern arrives (M9): extracted from a project, or imported
 * from a bundle. Each is an inline panel under the head; a name already in
 * the library comes back as a 409 the panel turns into Replace or Keep mine.
 */
const open = ref<"" | "extract" | "import">("");
const dir = ref("");
const name = ref("");
const file = ref("");
const busy = ref(false);
/** The pattern name the daemon refused to replace, until Replace or Keep mine. */
const taken = ref("");

function show(panel: "extract" | "import"): void {
  open.value = open.value === panel ? "" : panel;
  taken.value = "";
  error.value = "";
}

async function extract(force = false): Promise<void> {
  await arrive(
    async () => {
      const saved = await api.extract(dir.value, name.value, force);
      toast(
        "success",
        `Saved "${saved.name}" (facets: ${saved.facets.join(", ") || "none"}${
          saved.captured ? `; ${saved.captured} config${saved.captured === 1 ? "" : "s"} captured` : ""
        }).`,
      );
      return saved.name;
    },
    name.value || dir.value.split("/").filter(Boolean).pop() || "",
  );
}

async function importIt(force = false): Promise<void> {
  await arrive(async () => {
    const imported = await api.importBundle(file.value, force);
    toast("success", `Imported "${imported.name}"${imported.description ? `: ${imported.description}` : ""}`);
    return imported.name;
  }, file.value.split("/").pop()?.replace(/\.dolly$/, "") ?? "");
}

/** Runs one arrival, then opens what arrived; a 409 asks before replacing. */
async function arrive(verb: () => Promise<string>, guess: string): Promise<void> {
  busy.value = true;
  error.value = "";
  try {
    const arrived = await verb();
    open.value = "";
    taken.value = "";
    await load();
    visit(arrived);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 409) taken.value = guess || "that name";
    else error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

function href(name: string): string {
  return `#/pattern/${encodeURIComponent(name)}`;
}

// The chevron is a button, not a link: templates cannot reach `location`.
function visit(name: string): void {
  location.hash = href(name);
}

onMounted(load);
</script>

<template>
  <section>
    <div class="page-head">
      <div class="sub">
        <h1>Patterns</h1>
        <span v-if="!loading && patterns.length" class="note">
          {{ patterns.length }} saved<template v-if="home"> in {{ home }}</template>
        </span>
      </div>
      <span class="pick">
        <button type="button" :class="{ primary: open === 'import' }" :aria-pressed="open === 'import'" @click="show('import')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 4.5v11" />
            <path d="m8 11.5 4 4 4-4" />
            <path d="M4.5 17.5v1a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1" />
          </svg>
          Import a bundle
        </button>
        <button type="button" :class="{ primary: open !== 'import' }" :aria-pressed="open === 'extract'" @click="show('extract')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4.5 6.5h15" />
            <path d="M4.5 12h9" />
            <path d="M4.5 17.5h6" />
            <path d="m16.5 13.5 3 3-3 3" />
          </svg>
          Extract a project
        </button>
      </span>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <form v-if="open === 'extract'" class="panel flow" @submit.prevent="extract()">
      <div class="panel-head">
        <h3>Extract a project</h3>
        <span class="count">the same inference as <code>dolly extract</code>: nothing is declared, and what falls short of a facet lands in the notes</span>
      </div>
      <div class="panel-body stack">
        <div class="toolbar bare">
          <PathField v-model="dir" kind="directory" name="extract-dir" placeholder="/path/to/project" title="Choose the project to learn from" />
          <label class="field" data-role="pattern">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3.5" y="3.5" width="7.4" height="7.4" rx="1.6" />
              <rect x="13.1" y="3.5" width="7.4" height="7.4" rx="1.6" />
              <rect x="3.5" y="13.1" width="7.4" height="7.4" rx="1.6" />
              <rect x="13.1" y="13.1" width="7.4" height="7.4" rx="1.6" />
            </svg>
            <input v-model.trim="name" class="mono" name="extract-name" placeholder="name (the directory's by default)" spellcheck="false" />
          </label>
          <button class="primary" type="submit" :disabled="busy || !dir">Extract</button>
          <button class="ghost" type="button" @click="open = ''">Cancel</button>
        </div>
        <div v-if="taken" class="callout actions-row">
          <span><strong>A pattern named {{ taken }} already exists.</strong> Replace it with this extraction?</span>
          <span class="pick">
            <button type="button" :disabled="busy" @click="extract(true)">Replace</button>
            <button class="ghost" type="button" @click="taken = ''">Keep mine</button>
          </span>
        </div>
        <span v-else class="note">The name defaults to the directory's. A pattern that already has it is not replaced without asking.</span>
      </div>
    </form>

    <form v-if="open === 'import'" class="panel flow" @submit.prevent="importIt()">
      <div class="panel-head">
        <h3>Import a bundle</h3>
        <span class="count">a .dolly file someone exported; it is checked whole before anything is written</span>
      </div>
      <div class="panel-body stack">
        <div class="toolbar bare">
          <PathField v-model="file" kind="bundle" name="import-file" placeholder="/path/to/pattern.dolly" />
          <button class="primary" type="submit" :disabled="busy || !file">Import</button>
          <button class="ghost" type="button" @click="open = ''">Cancel</button>
        </div>
        <div v-if="taken" class="callout actions-row">
          <span><strong>A pattern named {{ taken }} already exists.</strong> Replace it with the bundle's?</span>
          <span class="pick">
            <button type="button" :disabled="busy" @click="importIt(true)">Replace</button>
            <button class="ghost" type="button" @click="taken = ''">Keep mine</button>
          </span>
        </div>
      </div>
    </form>

    <div v-if="loading" class="panel" aria-hidden="true">
      <div class="skeleton">
        <div class="skeleton-line" style="width: 32%"></div>
        <div class="skeleton-line" style="width: 70%"></div>
      </div>
      <div class="skeleton">
        <div class="skeleton-line" style="width: 38%"></div>
        <div class="skeleton-line" style="width: 64%"></div>
        <div class="skeleton-line" style="width: 52%"></div>
      </div>
      <div class="skeleton">
        <div class="skeleton-line" style="width: 28%"></div>
        <div class="skeleton-line" style="width: 74%"></div>
      </div>
    </div>

    <div v-else-if="!error && patterns.length === 0" class="empty">
      <img alt="" src="/logo.svg" />
      <h2>No patterns yet</h2>
      <p>Extract a project you like, and dolly learns its shape; or import a bundle someone shared.</p>
    </div>

    <div v-else class="stack">
      <div class="panel">
        <table>
          <thead>
            <tr>
              <th>Pattern</th>
              <th>Facets</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in patterns" :key="p.name" class="row">
              <td>
                <div><strong><a class="mono" :href="href(p.name)">{{ p.name }}</a></strong></div>
                <div v-if="p.error" class="note">{{ p.error }}</div>
                <div v-else-if="p.description" class="note">{{ p.description }}</div>
              </td>
              <td>
                <span v-if="p.error" class="note">Open to fix it</span>
                <FacetChips v-else :pattern="facets[p.name]" />
              </td>
              <td>
                <span v-if="p.error" class="badge broken">invalid pattern.md</span>
                <span v-else class="badge">valid</span>
              </td>
              <td class="actions">
                <button class="ghost small delete" type="button" @click="remove(p.name)">delete</button>
                <button class="ghost small" type="button" :aria-label="`Open ${p.name}`" @click="visit(p.name)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="m9.5 6 6 6-6 6" />
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  </section>
</template>
