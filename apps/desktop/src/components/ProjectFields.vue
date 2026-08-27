<script setup lang="ts">
import { onMounted, watch } from "vue";
import PathField from "./PathField.vue";

/**
 * The two inputs check, fit, and learn share: a project directory and,
 * optionally, the pattern to judge it by (the project's `.dolly` marker
 * names one otherwise). The directory is remembered across views and
 * visits, here, so each view only reads its model.
 */
const REMEMBERED_DIR = "dolly:check-dir";

const dir = defineModel<string>("dir", { required: true });
const pattern = defineModel<string>("pattern", { required: true });

// Restored once mounted: a model set during the parent's own render is
// swallowed by the scheduler, so the input would stay blank while the view
// already held the directory.
onMounted(() => {
  if (!dir.value) dir.value = localStorage.getItem(REMEMBERED_DIR) ?? "";
});
watch(dir, (value) => localStorage.setItem(REMEMBERED_DIR, value));
</script>

<template>
  <PathField v-model="dir" kind="directory" name="dir" placeholder="/path/to/project" title="Choose the project directory" />
  <label class="field" data-role="pattern">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7.4" height="7.4" rx="1.6" />
      <rect x="13.1" y="3.5" width="7.4" height="7.4" rx="1.6" />
      <rect x="3.5" y="13.1" width="7.4" height="7.4" rx="1.6" />
      <rect x="13.1" y="13.1" width="7.4" height="7.4" rx="1.6" />
    </svg>
    <input
      v-model.trim="pattern"
      name="pattern"
      placeholder="pattern (from its .dolly marker)"
      spellcheck="false"
    />
  </label>
</template>
