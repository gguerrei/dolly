<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import {
  api,
  type CheckReport,
  type CheckViolation,
  type Marker,
  RULE_IDS,
  type RuleSetting,
  watchChecks,
} from "../api";
import Message from "../components/Message.vue";
import ProjectFields from "../components/ProjectFields.vue";
import { toast } from "../lib/toasts";

const dir = ref(""); // remembered by ProjectFields
const patternName = ref("");
const report = ref<CheckReport | null>(null);
const error = ref("");
const busy = ref(false);
const watching = ref(false);
/** `dolly check --conventions`: the model reads the prose too, with AI on. */
const conventions = ref(false);
/** The project's `.dolly`, shown once a check has run on a directory that carries one. */
const marker = ref<Marker | null>(null);
const LEVELS = ["on", "warn", "off"] as const;
let dispose: (() => void) | null = null;

async function loadMarker(): Promise<void> {
  marker.value = await api.marker(dir.value).catch(() => null);
}

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
      ...(conventions.value ? { conventions: true } : {}),
    });
    await loadMarker();
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

/** `dolly ignore` from the row: the path joins the marker's list, and the check runs again. */
async function ignore(path: string): Promise<void> {
  try {
    await api.ignore(dir.value, [path]);
    toast("success", `Ignoring ${path} in .dolly.`);
    await run(false);
  } catch (cause) {
    toast("error", cause instanceof Error ? cause.message : String(cause));
  }
}

/** `dolly ignore --remove` from the panel's chip: the path leaves the list, and the check runs again. */
async function stopIgnoring(path: string): Promise<void> {
  if (!marker.value) return;
  await edit({ ignore: marker.value.ignore.filter((entry) => entry !== path) }, `No longer ignoring ${path}.`);
}

function levelOf(rule: (typeof RULE_IDS)[number]): (typeof LEVELS)[number] {
  return marker.value?.rules[rule] ?? "on";
}

/** `dolly rules` from the panel's segments: on clears the setting, warn and off write it. */
async function setRule(rule: (typeof RULE_IDS)[number], level: (typeof LEVELS)[number]): Promise<void> {
  if (!marker.value || levelOf(rule) === level) return;
  const rules = { ...marker.value.rules };
  if (level === "on") delete rules[rule];
  else rules[rule] = level as RuleSetting;
  await edit({ rules }, `Rule ${rule} is ${level}.`);
}

/** One write for every panel change (`POST /api/marker`), then the check again so the report agrees with the marker. */
async function edit(change: { ignore?: string[]; rules?: Marker["rules"] }, said: string): Promise<void> {
  try {
    marker.value = await api.editMarker(dir.value, change);
    toast("success", said);
    await run(false);
  } catch (cause) {
    toast("error", cause instanceof Error ? cause.message : String(cause));
  }
}

/** The panel's head: where the pattern lives, and how much the marker sets aside. */
const markerSummary = computed(() => {
  if (!marker.value) return "";
  const source = marker.value.source ? `, source ${marker.value.source}` : "";
  const down = Object.keys(marker.value.rules).length;
  const ignored = marker.value.ignore.length;
  return `pattern ${marker.value.pattern}${source}; ${ignored} ignored path${ignored === 1 ? "" : "s"}, ${down} rule${down === 1 ? "" : "s"} turned down`;
});

const fixableCount = computed(() => report.value?.violations.filter((v) => v.fixable).length ?? 0);
const warningCount = computed(
  () => report.value?.violations.filter((v) => v.severity === "warning").length ?? 0,
);
/** What would fail the check: every violation the marker did not turn down to a warning. */
const failingCount = computed(() => (report.value?.violations.length ?? 0) - warningCount.value);

/** A rule panel's count: the violations, how many Fix would take, and how many are only warnings. */
function tally(items: CheckViolation[]): string {
  const fixable = items.filter((v) => v.fixable).length;
  const warnings = items.filter((v) => v.severity === "warning").length;
  const violations = `${items.length} violation${items.length === 1 ? "" : "s"}`;
  const parts = [
    ...(fixable === 0 ? [] : [fixable === items.length ? "fixable" : `${fixable} fixable`]),
    ...(warnings === 0 ? [] : [warnings === items.length ? "warnings only" : `${warnings} warning${warnings === 1 ? "" : "s"}`]),
  ];
  return parts.length ? `${violations}, ${parts.join(", ")}` : violations;
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
      <!-- Same as dolly check --conventions: one model call reads the prose, with AI on; a watcher never calls it. -->
      <label class="toggle" title="With AI on, the model reads the prose conventions against the files changed since HEAD; reported apart, never counted">
        <input v-model="conventions" type="checkbox" :disabled="busy || watching" />
        Conventions
      </label>
    </form>

    <p v-if="error" class="error">{{ error }}</p>

    <!-- The marker as the project's own word: what the row actions and dolly ignore and dolly rules write. -->
    <div v-if="marker" class="panel marker">
      <div class="panel-head">
        <h3>.dolly</h3>
        <span class="count">{{ markerSummary }}</span>
      </div>
      <table class="kv">
        <tbody>
          <tr>
            <td class="k">ignored paths</td>
            <td>
              <ul v-if="marker.ignore.length" class="chips removable">
                <li v-for="path in marker.ignore" :key="path">
                  <span class="mono">{{ path }}</span>
                  <button type="button" :disabled="busy || watching" :title="`Stop ignoring ${path}`" @click="stopIgnoring(path)">×</button>
                </li>
              </ul>
              <span v-else class="muted">none; a row's ignore action adds one</span>
            </td>
          </tr>
          <tr>
            <td class="k">rules</td>
            <td>
              <div class="rules">
                <div v-for="rule in RULE_IDS" :key="rule" class="rule">
                  <span class="mono">{{ rule }}</span>
                  <div class="segmented">
                    <button
                      v-for="level in LEVELS"
                      :key="level"
                      type="button"
                      :class="{ on: levelOf(rule) === level }"
                      :disabled="busy || watching"
                      @click="setRule(rule, level)"
                    >
                      {{ level }}
                    </button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <template v-if="report">
      <div class="stats five">
        <div class="stat">
          <span class="n" :class="{ warm: failingCount > 0 }">{{ report.violations.length }}</span>
          <span class="l">violation{{ report.violations.length === 1 ? "" : "s" }}<template v-if="warningCount">, {{ warningCount }} warning{{ warningCount === 1 ? "" : "s" }}</template></span>
        </div>
        <div class="stat">
          <span class="n">{{ fixableCount }}</span>
          <span class="l">fixable</span>
        </div>
        <div class="stat">
          <span class="n">{{ report.ignored }}</span>
          <span class="l">ignored by .dolly</span>
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

      <div class="panels report">
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
                <td><Message :text="violation.message" /></td>
                <td class="actions">
                  <span v-if="violation.fixable" class="badge">fixable</span>
                  <span v-if="violation.severity === 'warning'" class="badge">warning</span>
                  <button
                    class="ghost small"
                    type="button"
                    :disabled="busy || watching"
                    title="Add this path to the marker's ignore list"
                    @click="ignore(violation.path)"
                  >
                    ignore
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="report.conventions" class="panel">
          <div class="panel-head">
            <h3>conventions</h3>
            <span class="count">as {{ report.conventions.model }} reads them; never counted</span>
          </div>
          <table>
            <tbody>
              <tr v-if="report.conventions.findings.length === 0" class="row">
                <td class="path"></td>
                <td colspan="2">nothing to report</td>
              </tr>
              <tr
                v-for="finding in report.conventions.findings"
                :key="`${finding.path}:${finding.line ?? ''}:${finding.message}`"
                class="row"
              >
                <td class="path">{{ finding.path }}<template v-if="finding.line">:{{ finding.line }}</template></td>
                <td>{{ finding.message }}</td>
                <td class="actions"><span class="badge">{{ report.conventions.model }}</span></td>
              </tr>
              <tr v-for="line in report.conventions.skipped" :key="line" class="sub">
                <td class="path"></td>
                <td colspan="2">skipped {{ line }}</td>
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

<style scoped>
.marker {
  margin-bottom: 14px;
}

.chips.removable li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-right: 3px;
}

.chips.removable button {
  height: 18px;
  padding: 0 5px;
  border: none;
  background: transparent;
  color: var(--grey);
  font-size: 13px;
  line-height: 1;
}

.chips.removable button:hover:not(:disabled) {
  color: var(--charcoal);
  background: var(--hover);
}

.rules {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px 16px;
}

.rule {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
}

.rule .segmented {
  padding: 2px;
  gap: 1px;
}

.rule .segmented button {
  height: 20px;
  padding: 0 7px;
  font-size: 11.5px;
}
</style>
