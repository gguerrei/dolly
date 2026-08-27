<script setup lang="ts">
import { hasPickers, pickBundle, pickDirectory } from "../lib/native";

/**
 * A path input with a Browse button beside it inside the native shell, where
 * a picker exists; in a plain browser the path is typed and the button is
 * absent. The one field every flow that touches the disk shares.
 */
const props = defineProps<{
  kind: "directory" | "bundle";
  name: string;
  placeholder: string;
  title?: string;
}>();
const model = defineModel<string>({ required: true });

async function browse(): Promise<void> {
  const picked =
    props.kind === "directory"
      ? await pickDirectory(props.title ?? "Choose a directory")
      : await pickBundle();
  if (picked) model.value = picked;
}
</script>

<template>
  <label class="field" :data-role="kind === 'directory' ? 'dir' : 'file'">
    <svg v-if="kind === 'directory'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.4l2 2h7.6A1.5 1.5 0 0 1 20.5 9v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17z" />
    </svg>
    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6.5 3.5h7l4 4v13h-11z" />
      <path d="M13.5 3.5v4h4" />
    </svg>
    <input v-model.trim="model" class="mono" :name="name" :placeholder="placeholder" spellcheck="false" />
  </label>
  <button v-if="hasPickers" type="button" @click="browse">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.4l2 2h7.6A1.5 1.5 0 0 1 20.5 9v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17z" />
    </svg>
    Browse
  </button>
</template>
