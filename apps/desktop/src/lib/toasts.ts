import { readonly, ref } from "vue";

/** Ephemeral feedback for actions that would otherwise succeed silently. */
export interface Toast {
  id: number;
  kind: "success" | "error";
  message: string;
}

const list = ref<Toast[]>([]);
let nextId = 1;

export function toast(kind: Toast["kind"], message: string): void {
  const id = nextId++;
  list.value = [...list.value, { id, kind, message }];
  setTimeout(() => dismiss(id), 3800);
}

export function dismiss(id: number): void {
  list.value = list.value.filter((t) => t.id !== id);
}

export const toasts = readonly(list);
