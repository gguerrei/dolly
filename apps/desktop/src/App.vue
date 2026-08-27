<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api, hasToken } from "./api";
import CommandPalette from "./components/CommandPalette.vue";
import { aiStatus as ai, refreshAi } from "./lib/ai";
import { dismiss, toasts } from "./lib/toasts";
import { route } from "./router";
import CheckView from "./views/CheckView.vue";
import ExportView from "./views/ExportView.vue";
import FitView from "./views/FitView.vue";
import LearnView from "./views/LearnView.vue";
import LibraryView from "./views/LibraryView.vue";
import PatternView from "./views/PatternView.vue";
import SettingsView from "./views/SettingsView.vue";

const ready = hasToken();
const daemonVersion = ref("");
const daemonLive = ref(false);
const palette = ref<InstanceType<typeof CommandPalette> | null>(null);
let pulse: ReturnType<typeof setInterval> | undefined;

async function ping(): Promise<void> {
  try {
    const health = await api.health();
    daemonVersion.value = health.version;
    daemonLive.value = true;
  } catch {
    daemonLive.value = false;
    return;
  }
  // Once, not per pulse: the key lookup behind /api/ai can raise an OS keychain prompt.
  if (!ai.value) await refreshAi();
}

/** The sidebar's AI line, mirroring `dolly ai status`: off, on, or on without a key. */
const aiLine = computed(() => {
  const status = ai.value;
  if (!status?.provider) return { label: "AI off", detail: "dolly ai connect", title: "dolly ai connect turns it on" };
  if (status.keySource === "missing") {
    return {
      label: "AI on",
      detail: "no key",
      title: `No key found for ${status.provider}; run dolly ai connect ${status.provider}`,
    };
  }
  return { label: "AI on", detail: status.model ?? "", title: `${status.provider}, key from the ${status.keySource}` };
});

const searchKey = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

/** The top bar's trail: where you are, and the pattern you are in. */
const crumbs = computed(() => {
  switch (route.value.view) {
    case "pattern":
      return { root: "Library", here: route.value.name, mono: true };
    case "check":
      return { root: "", here: "Check", mono: false };
    case "fit":
      return { root: "", here: "Fit", mono: false };
    case "learn":
      return { root: "", here: "Learn", mono: false };
    case "export":
      return { root: "", here: "Export", mono: false };
    case "settings":
      return { root: "Settings", here: "AI", mono: false };
    default:
      return { root: "", here: "Library", mono: false };
  }
});

onMounted(() => {
  if (ready) {
    void ping();
    pulse = setInterval(ping, 30_000);
  }
});
onBeforeUnmount(() => clearInterval(pulse));
</script>

<template>
  <div class="app">
    <aside class="sidebar">
      <a class="brand" href="#/">
        <img alt="" src="/logo.svg" />
        <span>dolly</span>
      </a>
      <nav class="nav">
        <div class="nav-label">Patterns</div>
        <a href="#/" :class="{ active: route.view === 'library' || route.view === 'pattern' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3.5" y="3.5" width="7.4" height="7.4" rx="1.6" />
            <rect x="13.1" y="3.5" width="7.4" height="7.4" rx="1.6" />
            <rect x="3.5" y="13.1" width="7.4" height="7.4" rx="1.6" />
            <rect x="13.1" y="13.1" width="7.4" height="7.4" rx="1.6" />
          </svg>
          Library
        </a>
        <a href="#/check" :class="{ active: route.view === 'check' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" />
            <path d="m8.4 12.3 2.5 2.5 4.7-5.2" />
          </svg>
          Check
        </a>
        <a href="#/fit" :class="{ active: route.view === 'fit' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3.5 12h11" />
            <path d="m10.5 8 4 4-4 4" />
            <path d="M17.5 4.5h3v15h-3" />
          </svg>
          Fit
        </a>
        <a href="#/learn" :class="{ active: route.view === 'learn' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3.5 5.5h5.5a3 3 0 0 1 3 3v10.5a2 2 0 0 0-2-2h-6.5z" />
            <path d="M20.5 5.5H15a3 3 0 0 0-3 3v10.5a2 2 0 0 1 2-2h6.5z" />
          </svg>
          Learn
        </a>
        <a href="#/export" :class="{ active: route.view === 'export' }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 15V4" />
            <path d="m8 8 4-4 4 4" />
            <path d="M4.5 14.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
          </svg>
          Export
        </a>
      </nav>
      <div class="side-foot">
        <a v-if="ai" class="row" :class="{ active: route.view === 'settings' }" href="#/settings" :title="aiLine.title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 4.5v3M12 16.5v3M4.5 12h3M16.5 12h3M6.7 6.7l2.1 2.1M15.2 15.2l2.1 2.1M6.7 17.3l2.1-2.1M15.2 8.8l2.1-2.1" />
          </svg>
          <span>{{ aiLine.label }}</span>
          <span class="mono">{{ aiLine.detail }}</span>
        </a>
        <div class="row">
          <span class="dot" :class="{ offline: ready && !daemonLive }" aria-hidden="true"></span>
          <span v-if="!ready">no session key</span>
          <span v-else-if="daemonLive">daemon v{{ daemonVersion }}</span>
          <span v-else>daemon offline</span>
        </div>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="crumbs">
          <template v-if="crumbs.root">
            <span>{{ crumbs.root }}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m9.5 6 6 6-6 6" />
            </svg>
          </template>
          <span class="here" :class="{ mono: crumbs.mono }">{{ crumbs.here }}</span>
        </div>
        <button v-if="ready" class="search" type="button" @click="palette?.show()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <span>Search patterns</span>
          <kbd>{{ searchKey }}</kbd>
        </button>
      </header>

      <main v-if="!ready" class="content">
        <div class="notice">
          <img alt="" src="/logo.svg" width="96" />
          <h1>This tab has no key</h1>
          <p>
            Open the exact URL <code>dolly serve</code> printed. The
            <code>#token</code> in it is this run's key, and the page picks it
            up from there.
          </p>
        </div>
      </main>
      <main v-else class="content">
        <LibraryView v-if="route.view === 'library'" />
        <PatternView v-else-if="route.view === 'pattern'" :key="route.name" :name="route.name" />
        <FitView v-else-if="route.view === 'fit'" />
        <LearnView v-else-if="route.view === 'learn'" />
        <ExportView v-else-if="route.view === 'export'" :key="route.name ?? ''" :name="route.name" />
        <SettingsView v-else-if="route.view === 'settings'" />
        <CheckView v-else />
      </main>
    </div>

    <CommandPalette v-if="ready" ref="palette" />

    <div class="toasts" aria-live="polite">
      <button
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="t.kind"
        type="button"
        @click="dismiss(t.id)"
      >
        {{ t.message }}
      </button>
    </div>
  </div>
</template>
