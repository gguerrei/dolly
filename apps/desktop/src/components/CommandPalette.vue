<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api, type PatternSummary } from "../api";

/**
 * The ⌘K palette: every view and every saved pattern, one keystroke away.
 * Patterns are fetched on open so the list is never stale.
 */

interface Entry {
  label: string;
  hint: string;
  kind: "view" | "pattern";
  href: string;
}

const VIEWS: Entry[] = [
  { label: "Library", hint: "every saved pattern", kind: "view", href: "#/" },
  { label: "Check", hint: "lint a project against its pattern", kind: "view", href: "#/check" },
  { label: "Fit", hint: "plan and apply moves and fixes", kind: "view", href: "#/fit" },
  { label: "Learn", hint: "watch a project, review drafted pattern edits", kind: "view", href: "#/learn" },
  { label: "Export", hint: "render a pattern for an agent or an editor", kind: "view", href: "#/export" },
  { label: "AI", hint: "providers, keys, and the switch", kind: "view", href: "#/settings" },
];

const open = ref(false);
const query = ref("");
const cursor = ref(0);
const patterns = ref<PatternSummary[]>([]);
const input = ref<HTMLInputElement | null>(null);
let returnFocusTo: HTMLElement | null = null;

const entries = computed<Entry[]>(() => {
  const all = [
    ...VIEWS,
    ...patterns.value.map((p) => ({
      label: p.name,
      hint: p.error ? "invalid pattern.md" : p.description,
      kind: "pattern" as const,
      href: `#/pattern/${encodeURIComponent(p.name)}`,
    })),
  ];
  const needle = query.value.trim().toLowerCase();
  if (!needle) return all;
  return all.filter((e) => `${e.label} ${e.hint}`.toLowerCase().includes(needle));
});

// Typing restarts the cursor; a list that merely grew (patterns arriving) keeps it.
watch(query, () => {
  cursor.value = 0;
});

// The list scrolls past eight or so entries; keep the active one in sight.
watch(cursor, async () => {
  await nextTick();
  document.querySelector(".palette li.active")?.scrollIntoView({ block: "nearest" });
});

async function show(): Promise<void> {
  returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  open.value = true;
  query.value = "";
  cursor.value = 0;
  await nextTick();
  input.value?.focus();
  try {
    patterns.value = await api.listPatterns();
  } catch {
    patterns.value = []; // the views still list; the daemon's own error shows in place
  }
}

function hide(): void {
  open.value = false;
  returnFocusTo?.focus();
  returnFocusTo = null;
}

function go(entry: Entry | undefined): void {
  if (!entry) return;
  location.hash = entry.href;
  hide();
}

function onKey(event: KeyboardEvent): void {
  if (event.defaultPrevented) return; // the editor's own ctrl-k stays the editor's
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (open.value) hide();
    else void show();
    return;
  }
  if (!open.value) return;
  if (event.key === "Escape") hide();
  else if (event.key === "ArrowDown") {
    event.preventDefault();
    cursor.value = Math.min(cursor.value + 1, entries.value.length - 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    cursor.value = Math.max(cursor.value - 1, 0);
  } else if (event.key === "Enter") go(entries.value[cursor.value]);
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

defineExpose({ show });
</script>

<template>
  <div v-if="open" class="palette-backdrop" @click.self="hide">
    <div class="palette" role="dialog" aria-modal="true" aria-label="Search patterns">
      <input
        ref="input"
        v-model="query"
        placeholder="Search patterns and views"
        spellcheck="false"
        role="combobox"
        aria-label="Search"
        aria-controls="palette-entries"
        :aria-expanded="entries.length > 0"
        :aria-activedescendant="entries.length ? `palette-entry-${cursor}` : undefined"
      />
      <ul v-if="entries.length" id="palette-entries" role="listbox">
        <li
          v-for="(entry, index) in entries"
          :id="`palette-entry-${index}`"
          :key="entry.href"
          role="option"
          :aria-selected="index === cursor"
          :class="{ active: index === cursor }"
          @mouseenter="cursor = index"
          @click="go(entry)"
        >
          <span :class="{ mono: entry.kind === 'pattern' }">{{ entry.label }}</span>
          <span class="note">{{ entry.hint }}</span>
          <span class="kind">{{ entry.kind }}</span>
        </li>
      </ul>
      <p v-else class="none">Nothing matches "{{ query }}".</p>
    </div>
  </div>
</template>
