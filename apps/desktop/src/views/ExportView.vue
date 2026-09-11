<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { api, ApiError, type RenderedExport } from "../api";
import ProjectFields from "../components/ProjectFields.vue";
import { toast } from "../lib/toasts";

/**
 * The export view: `dolly export --as` with the file in sight. Pick a target,
 * read the rendered file, save it at the target's own path under the project
 * directory the other views share, or copy it. The preview is a pure function
 * of the pattern, so it refreshes on every change without a button.
 */

const props = defineProps<{ name?: string }>();

interface Target {
  id: string;
  label: string;
  /** Where the reader expects the file; `{name}` is the pattern's. */
  path: string;
  why: string;
}

const TARGETS: Target[] = [
  { id: "agents-md", label: "AGENTS.md", path: "AGENTS.md", why: "Read by most coding agents at the project root." },
  {
    id: "claude-skill",
    label: "Claude skill",
    path: ".claude/skills/{name}/SKILL.md",
    why: "Picked up by Claude Code when the pattern applies.",
  },
  { id: "claude-md", label: "CLAUDE.md", path: "CLAUDE.md", why: "Read by Claude Code at the project root." },
  { id: "cursor", label: "Cursor rule", path: ".cursor/rules/{name}.mdc", why: "Always applied in Cursor." },
  {
    id: "copilot",
    label: "Copilot instructions",
    path: ".github/copilot-instructions.md",
    why: "Read by GitHub Copilot in every chat and review.",
  },
  { id: "gemini", label: "GEMINI.md", path: "GEMINI.md", why: "Read by Gemini CLI at the project root." },
  {
    id: "windsurf",
    label: "Windsurf rule",
    path: ".windsurf/rules/{name}.md",
    why: "Always on in Windsurf.",
  },
  { id: "cline", label: "Cline rule", path: ".clinerules/{name}.md", why: "Read by Cline from the rules folder." },
  {
    id: "prompt",
    label: "System prompt",
    path: "{name}.prompt.md",
    why: "One paragraph in front of the brief, for anything else.",
  },
];

const dir = ref(""); // remembered by ProjectFields
const patternName = ref(props.name ?? "");
const target = ref(TARGETS[0] as Target);
const rendered = ref<RenderedExport | null>(null);
const error = ref("");
const busy = ref(false);
/** The path the daemon refused to overwrite, until Replace or Keep mine. */
const conflict = ref("");

const size = computed(() => {
  const bytes = new TextEncoder().encode(rendered.value?.contents ?? "").length;
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
});
const sourceName = computed(() => rendered.value?.path.split("/").pop() ?? target.value.label);
/** A target's path with the pattern's name in it. */
const pathOf = (t: Target) => t.path.replace("{name}", patternName.value || "<pattern>");

let pending: ReturnType<typeof setTimeout> | undefined;

async function preview(): Promise<void> {
  if (!dir.value) {
    rendered.value = null;
    error.value = "";
    return;
  }
  try {
    rendered.value = await api.exportPreview(dir.value, patternName.value || undefined, target.value.id);
    error.value = "";
  } catch (cause) {
    rendered.value = null;
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

/** A short pause after typing, so a half-typed name is not a flash of 404. */
function schedulePreview(): void {
  clearTimeout(pending);
  pending = setTimeout(() => void preview(), 350);
}

watch([dir, patternName], () => {
  conflict.value = "";
  schedulePreview();
});
watch(target, () => {
  conflict.value = "";
  void preview();
});
onBeforeUnmount(() => clearTimeout(pending));
void preview();

async function save(force = false): Promise<void> {
  if (!rendered.value) return;
  busy.value = true;
  try {
    const { path } = await api.exportSave(dir.value, patternName.value || undefined, target.value.id, force);
    conflict.value = "";
    toast("success", `Saved ${path}`);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 409) {
      conflict.value = `${dir.value.replace(/\/$/, "")}/${rendered.value.path}`;
    } else {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    busy.value = false;
  }
}

async function copy(): Promise<void> {
  if (!rendered.value) return;
  try {
    await navigator.clipboard.writeText(rendered.value.contents);
    toast("success", `Copied ${sourceName.value} to the clipboard.`);
  } catch {
    error.value = "The browser refused the clipboard; select the preview and copy it by hand.";
  }
}
</script>

<template>
  <section>
    <div class="page-head">
      <div class="sub">
        <h1>Export a pattern</h1>
        <span class="note">
          One file for the tools that read conventions but never read pattern.md: the facets as plain
          prose, your conventions verbatim, the same brief in every frame.
        </span>
      </div>
      <span class="note nowrap">Same file as <code>dolly export --as</code></span>
    </div>

    <form class="panel toolbar" @submit.prevent="save()">
      <ProjectFields v-model:dir="dir" v-model:pattern="patternName" />
      <button type="button" :disabled="!rendered" @click="copy">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
          <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
        </svg>
        Copy
      </button>
      <button class="primary" type="submit" :disabled="busy || !rendered">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 4.5v11" />
          <path d="m8 11.5 4 4 4-4" />
          <path d="M4.5 17.5v1a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1" />
        </svg>
        Save into project
      </button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="conflict" class="callout actions-row">
      <span>
        <strong>{{ conflict }} already exists.</strong> It is usually hand-written, so nothing was
        touched. Replace it with this export?
      </span>
      <span class="pick">
        <button type="button" :disabled="busy" @click="save(true)">Replace</button>
        <button class="ghost" type="button" @click="conflict = ''">Keep mine</button>
      </span>
    </div>

    <div class="export-grid">
      <div class="stack">
        <div class="panel">
          <div class="panel-head">
            <h3>Target</h3>
            <span class="count">lands at the path its reader expects</span>
          </div>
          <div class="targets">
            <button
              v-for="t in TARGETS"
              :key="t.id"
              class="target"
              :class="{ on: t.id === target.id }"
              type="button"
              :aria-pressed="t.id === target.id"
              @click="target = t"
            >
              <span class="t">
                <span class="name">{{ t.label }}</span>
                <span class="path">{{ pathOf(t) }}</span>
                <span class="why">{{ t.why }}</span>
              </span>
              <svg v-if="t.id === target.id" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            </button>
          </div>
          <div class="terminal">
            <span><strong>.dolly bundle</strong> for another dolly, from the terminal:</span>
            <code>dolly export {{ patternName || "<pattern>" }}</code>
          </div>
        </div>
        <span class="note">
          Keys never enter an export: it is rendered from pattern.md alone. Edit the pattern and
          export again rather than editing the file.
        </span>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>{{ sourceName }}</h3>
          <span v-if="rendered" class="count">rendered from {{ patternName || "the project's pattern" }}, {{ size }}</span>
        </div>
        <pre v-if="rendered" class="preview">{{ rendered.contents }}</pre>
        <div v-else class="empty">
          <p class="note">Name a project directory and the file renders here.</p>
        </div>
      </div>
    </div>
  </section>
</template>
