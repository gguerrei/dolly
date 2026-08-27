<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { type AiProviderStatus, api } from "../api";
import { aiStatus, refreshAi } from "../lib/ai";
import { toast } from "../lib/toasts";

/**
 * The AI surface: `dolly ai` verb for verb. Status per provider with where
 * its key lives, Use to pick the active one, Connect to paste a key that is
 * verified live before the keychain stores it, an optional model, and the
 * switch. Off keeps the keys.
 */

const providers = ref<AiProviderStatus[]>([]);
const loading = ref(true);
const error = ref("");
const busy = ref(false);
/** The provider whose connect form is open, if any. */
const connecting = ref<AiProviderStatus | null>(null);
const key = ref("");
const model = ref("");

const active = computed(() => aiStatus.value?.provider ?? null);
const on = computed(() => active.value !== null);

async function load(): Promise<void> {
  error.value = "";
  try {
    await refreshAi();
    providers.value = await api.aiProviders();
    model.value = aiStatus.value?.model ?? "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
  loading.value = false;
}

/** Runs one `dolly ai` verb, reloads, and says what happened. */
async function act(verb: () => Promise<unknown>, done: string): Promise<void> {
  busy.value = true;
  error.value = "";
  try {
    await verb();
    await load();
    toast("success", done);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

function use(provider: AiProviderStatus): Promise<void> {
  return act(() => api.aiUse(provider.id), `AI is on: ${provider.label}.`);
}

function saveModel(): Promise<void> {
  if (!active.value) return Promise.resolve();
  const chosen = model.value.trim();
  return act(
    () => api.aiUse(active.value as string, chosen || undefined),
    chosen ? `Model set to ${chosen}.` : "Back to the provider's default model.",
  );
}

function toggle(): Promise<void> {
  if (on.value) return act(() => api.aiOff(), "AI is off. Keys stay in the keychain.");
  // Turning on means picking a provider that has a key; without one, connecting is the way in.
  const ready = providers.value.find((p) => p.keySource !== "missing");
  if (ready) return use(ready);
  error.value = "Connect a provider first: none has a key yet.";
  return Promise.resolve();
}

function openConnect(provider: AiProviderStatus): void {
  connecting.value = provider;
  key.value = "";
  error.value = "";
}

function connect(): Promise<void> {
  const provider = connecting.value;
  if (!provider) return Promise.resolve();
  return act(async () => {
    await api.aiConnect(provider.id, key.value);
    connecting.value = null;
    key.value = "";
  }, `${provider.label} key verified and stored in the OS keychain.`);
}

function envVar(provider: AiProviderStatus): string {
  return { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GEMINI_API_KEY" }[provider.id];
}

onMounted(load);
</script>

<template>
  <section>
    <div class="page-head">
      <div class="sub">
        <h1>AI</h1>
        <span class="note">
          Bring your own key. Off by default, and off is fine: everything deterministic works
          without it.
        </span>
      </div>
      <button class="switch" type="button" :disabled="busy || loading" :aria-pressed="on" @click="toggle">
        <span class="track" :class="{ off: !on }"><span class="knob"></span></span>
        {{ on ? "On" : "Off" }}
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="loading" class="panel">
      <div class="skeleton">
        <div class="skeleton-line" style="width: 30%"></div>
        <div class="skeleton-line" style="width: 60%"></div>
        <div class="skeleton-line" style="width: 45%"></div>
      </div>
    </div>

    <div v-else class="stack">
      <div class="panel">
        <div class="panel-head">
          <h3>Provider</h3>
          <span class="count">
            {{ on ? "keys live in the OS keychain or the environment, never in a config file" : "connect one to turn AI on" }}
          </span>
        </div>
        <div v-for="provider in providers" :key="provider.id" class="provider">
          <span class="name">{{ provider.label }}</span>
          <span class="model">{{ provider.defaultModel }}</span>
          <span v-if="provider.keySource === 'missing'" class="note">no key</span>
          <span v-else class="badge">key in {{ provider.keySource }}</span>
          <div class="actions">
            <button
              v-if="active === provider.id"
              class="small primary"
              type="button"
              aria-pressed="true"
              :disabled="busy"
              @click="use(provider)"
            >
              Active
            </button>
            <button
              v-else-if="provider.keySource !== 'missing'"
              class="small"
              type="button"
              :disabled="busy"
              @click="use(provider)"
            >
              Use
            </button>
            <button
              class="small"
              :class="{ ghost: provider.keySource !== 'missing' }"
              type="button"
              :disabled="busy"
              @click="openConnect(provider)"
            >
              {{ provider.keySource === "missing" ? "Connect" : "Replace key" }}
            </button>
          </div>
        </div>
      </div>

      <form v-if="connecting" class="panel" @submit.prevent="connect">
        <div class="panel-head">
          <h3>Connect {{ connecting.label }}</h3>
          <span class="count">verified with a live call before it is stored</span>
        </div>
        <div class="panel-body stack" style="gap: 10px">
          <div style="display: flex; gap: 8px; align-items: center">
            <input
              v-model="key"
              type="password"
              autocomplete="off"
              spellcheck="false"
              :placeholder="`Paste your ${connecting.label} API key`"
              :aria-label="`${connecting.label} API key`"
            />
            <button class="primary" type="submit" :disabled="busy || !key.trim()">Verify and store</button>
            <button class="ghost" type="button" :disabled="busy" @click="connecting = null">Cancel</button>
          </div>
          <span class="note">
            The key goes to the OS keychain on this machine. It never enters a pattern, a bundle, an
            export, or a config file. Setting <code>{{ connecting.envVar }}</code> in your environment
            works too and wins over the keychain.
          </span>
        </div>
      </form>

      <div :class="on ? 'two-up' : 'stack'">
        <form v-if="on" class="panel" @submit.prevent="saveModel">
          <div class="panel-head"><h3>Model</h3></div>
          <div class="panel-body stack" style="gap: 8px">
            <div class="actions-row">
              <input
                v-model="model"
                class="mono"
                spellcheck="false"
                :placeholder="providers.find((p) => p.id === active)?.defaultModel"
                aria-label="Model"
                />
              <button type="submit" :disabled="busy">Save</button>
            </div>
            <span class="note">The active provider's model. Leave it empty for the provider's default.</span>
          </div>
        </form>

        <div class="panel">
          <div class="panel-head"><h3>What AI does in dolly</h3></div>
          <div class="panel-body facts">
            <span>
              <strong>Fit</strong>
              <span class="muted">labels a suggestion on the moves it could not decide alone; apply never reads it.</span>
            </span>
            <span>
              <strong>Learn</strong>
              <span class="muted">drafts convention lines from the files that changed, once per session, for you to accept or skip.</span>
            </span>
            <span>
              <strong>Everything else</strong>
              <span class="muted">
                is deterministic and calls nothing.<template v-if="!on">
                  Keys live in the OS keychain or the environment, never in a config file.
                </template>
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
