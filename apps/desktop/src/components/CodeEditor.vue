<script setup lang="ts">
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>();

const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

// The sheep palette in the editor: structure from weight and shade, the one
// warm tone for literals. Deliberately not a rainbow.
const highlight = HighlightStyle.define([
  { tag: tags.propertyName, fontWeight: "600" },
  { tag: tags.comment, color: "var(--grey)", fontStyle: "italic" },
  { tag: tags.string, color: "var(--grey)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--warm)" },
  { tag: tags.meta, color: "var(--grey)" },
  { tag: tags.heading, fontWeight: "650" },
]);

// Colors come from the CSS variables, so one theme serves both schemes.
const theme = EditorView.theme({
  "&": {
    backgroundColor: "var(--fleece)",
    color: "var(--charcoal)",
    border: "1px solid var(--line)",
    borderRadius: "10px",
    fontSize: "13.5px",
  },
  "&.cm-focused": { outline: "2px solid var(--charcoal)", outlineOffset: "2px" },
  ".cm-scroller": {
    fontFamily: "var(--mono)",
    lineHeight: "1.6",
    borderRadius: "10px",
    minHeight: "60vh",
  },
  ".cm-content": { padding: "12px 4px", caretColor: "var(--charcoal)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--grey)",
    border: "none",
    paddingLeft: "8px",
  },
  ".cm-activeLine": { backgroundColor: "var(--hover)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--charcoal)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--line)",
  },
  ".cm-cursor": { borderLeftColor: "var(--charcoal)" },
});

onMounted(() => {
  view = new EditorView({
    parent: host.value as HTMLElement,
    doc: props.modelValue,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      yaml(),
      syntaxHighlighting(highlight),
      theme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) emit("update:modelValue", update.state.doc.toString());
      }),
    ],
  });
});

watch(
  () => props.modelValue,
  (value) => {
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  },
);

onBeforeUnmount(() => view?.destroy());
</script>

<template>
  <div ref="host" class="code-editor"></div>
</template>
