import { ref } from "vue";
import { type AiStatus, api } from "../api";

/**
 * The AI switch as the whole app sees it: the sidebar line and the settings
 * view read the same status, so a change in one shows in the other at once.
 */
export const aiStatus = ref<AiStatus | null>(null);

/** Fetched on demand, never on a timer: the key lookup behind it can raise an OS keychain prompt. */
export async function refreshAi(): Promise<void> {
  try {
    aiStatus.value = await api.ai();
  } catch {
    // No line in the sidebar until a later refresh succeeds.
  }
}
