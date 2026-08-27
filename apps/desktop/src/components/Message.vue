<script setup lang="ts">
import { computed } from "vue";

/**
 * An engine message with its backticked spans as code, the way the boards
 * show `dolly fit` and `git add -A` inside a report line. The branches sit
 * on one line so no template whitespace lands beside a chip.
 */
const props = defineProps<{ text: string }>();

const parts = computed(() => props.text.split("`"));
</script>

<template>
  <span>
    <template v-for="(part, index) in parts" :key="index"><code v-if="index % 2 === 1">{{ part }}</code><template v-else>{{ part }}</template></template>
  </span>
</template>
