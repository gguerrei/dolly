<script setup lang="ts">
import { computed } from "vue";
import type { Pattern } from "../api";

const props = defineProps<{ pattern?: Pattern }>();

const FACETS = [
  "license",
  "languages",
  "naming",
  "layout",
  "toolchain",
  "testing",
  "commands",
  "dependencies",
  "scaffold",
  "commits",
  "releases",
] as const;

const chips = computed(() => {
  const pattern = props.pattern;
  if (!pattern) return [];
  return FACETS.filter((facet) => {
    const value = pattern[facet];
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  });
});
</script>

<template>
  <ul v-if="chips.length" class="chips">
    <li v-for="chip in chips" :key="chip">{{ chip }}</li>
  </ul>
</template>
