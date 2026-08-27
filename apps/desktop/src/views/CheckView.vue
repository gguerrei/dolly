<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { api, type CheckReport, type CheckViolation, watchChecks } from "../api";
import ProjectFields from "../components/ProjectFields.vue";
import { toast } from "../lib/toasts";

const dir = ref(""); // remembered by ProjectFields
const patternName = ref("");
const report = ref<CheckReport | null>(null);
const error = ref("");
const busy = ref(false);
const watching = ref(false);
let dispose: (() => void) | null = null;

async function run(fix: boolean): Promise<void> {
  if (!dir.value) {
    error.value = "Point dolly at a project directory first.";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    report.value = await api.check(dir.value, {
      pattern: patternName.value || undefined,
      fix,
    });
    if (fix) {
      const n = report.value.fixed.length;
      toast(n > 0 ? "success" : "error", n > 0 ? `Fixed ${n} issue${n === 1 ? "" : "s"}.` : "Nothing was fixable.");
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

function toggleWatch(): void {
  if (watching.value) {
    dispose?.();
    dispose = null;
    watching.value = false;
    return;
  }
  if (!dir.value) {
    error.value = "Point dolly at a project directory first.";
    return;
  }
  error.value = "";
  dispose = watchChecks(
    dir.value,
    patternName.value || undefined,
    (fresh) => {
      report.value = fresh;
    },
    (message) => {
      error.value = message;
    },
  );
  watching.value = true;
}

const fixableCount = computed(() => report.value?.violations.filter((v) => v.fixable).length ?? 0);

/** A rule panel's count: the violations, and how many of them Fix would take. */
function tally(items: CheckViolation[]): string {
  const fixable = items.filter((v) => v.fixable).length;
  const violations = `${items.length} violation${items.length === 1 ? "" : "s"}`;
  if (fixable === 0) return violations;
  return fixable === items.length ? `${violations}, fixable` : `${violations}, ${fixable} fixable`;
}

/** Violations grouped by rule, in the engine's reporting order. */
const groups = computed(() => {
  const byRule = new Map<string, CheckViolation[]>();
  for (const violation of report.value?.violations ?? []) {
    const bucket = byRule.get(violation.rule);
    if (bucket) bucket.push(violation);
    else byRule.set(violation.rule, [violation]);
  }
  return [...byRule.entries()].map(([rule, items]) => ({ rule, items, tally: tally(items) }));
});

onBeforeUnmount(() => dispose?.());
</script>

<template>
  <section>
    <div class="page-head">
      <div class="sub">
        <h1>Check a project</h1>
        <span class="note">Every rule, run against a project directory. Check only reads; Fix is the one write.</span>
      </div>
      <span v-if="watching" class="watching"><span class="dot" aria-hidden="true"></span>watching</span>
      <span v-else class="note">Same report as <code>dolly check</code> in that directory</span>
    </div>

    <form class="panel toolbar" @submit.prevent="run(false)">
      <ProjectFields v-model:dir="dir" v-model:pattern="patternName" />
      <button class="primary" type="submit" :disabled="busy || watching">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" />
          <path d="m8.4 12.3 2.5 2.5 4.7-5.2" />
        </svg>
        Check
      </button>
      <!-- Fixing pauses while watching: a watcher that edits the tree it watches is a feedback loop. -->
      <button
        type="button"
        :disabled="busy || watching || fixableCount === 0"
        :title="watching ? 'Stop watching to fix' : ''"
        @click="run(true)"
      >
        Fix{{ fixableCount > 0 ? ` ${fixableCount}` : "" }}
      </button>
      <button type="button" :disabled="busy" @click="toggleWatch">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {{ watching ? "Stop watching" : "Watch" }}
      </button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="report">
      <div class="stats">
        <div class="stat">
          <span class="n" :class="{ warm: report.violations.length > 0 }">{{ report.violations.length }}</span>
          <span class="l">violation{{ report.violations.length === 1 ? "" : "s" }}</span>
        </div>
        <div class="stat">
          <span class="n">{{ fixableCount }}</span>
          <span class="l">fixable</span>
        </div>
        <div class="stat">
          <span class="n">{{ report.diagnostics.length }}</span>
          <span class="l">pattern issue{{ report.diagnostics.length === 1 ? "" : "s" }}</span>
        </div>
        <div class="stat">
          <span class="l">against</span>
          <span class="n mono">{{ report.pattern }}</span>
        </div>
      </div>

      <div class="panels">
        <div v-if="report.violations.length === 0" class="panel">
          <div class="panel-body">Clean: this project follows "{{ report.pattern }}".</div>
        </div>

        <div v-if="report.diagnostics.length" class="callout">
          <strong>Pattern issues, fix the pattern, not the project:</strong>
          <ul>
            <li v-for="diagnostic in report.diagnostics" :key="diagnostic">{{ diagnostic }}</li>
          </ul>
        </div>

        <div v-if="report.fixed.length" class="panel">
          <div class="panel-head">
            <h3>fixed</h3>
            <span class="count">{{ report.fixed.length }} change{{ report.fixed.length === 1 ? "" : "s" }}</span>
          </div>
          <table>
            <tbody>
              <tr v-for="line in report.fixed" :key="line" class="row">
                <td><span class="badge">fixed</span> {{ line }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-for="group in groups" :key="group.rule" class="panel">
          <div class="panel-head">
            <h3 class="warm">{{ group.rule }}</h3>
            <span class="count">{{ group.tally }}</span>
          </div>
          <table>
            <tbody>
              <tr
                v-for="violation in group.items"
                :key="`${violation.rule}:${violation.path}:${violation.message}`"
                class="row"
              >
                <td class="path">{{ violation.path }}</td>
                <td>{{ violation.message }}</td>
                <td class="actions">
                  <span v-if="violation.fixable" class="badge">fixable</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <div v-else-if="!error" class="empty">
      <img alt="" src="/logo.svg" />
      <h2>Nothing checked yet</h2>
      <p>Point dolly at a project directory. The <code>.dolly</code> marker names its pattern.</p>
    </div>
  </section>
</template>
