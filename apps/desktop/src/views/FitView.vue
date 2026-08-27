<script setup lang="ts">
import { computed, ref } from "vue";
import { api, type FitReport, type FitStep } from "../api";
import ProjectFields from "../components/ProjectFields.vue";
import { toast } from "../lib/toasts";

const dir = ref(""); // remembered by ProjectFields
const patternName = ref("");
const report = ref<FitReport | null>(null);
const error = ref("");
const busy = ref(false);
const checkpoint = ref("");
/** What the pattern's own commands said about the last apply's translations. */
const verified = ref<string[]>([]);

async function plan(): Promise<void> {
  if (!dir.value) {
    error.value = "Point dolly at a project directory first.";
    return;
  }
  checkpoint.value = ""; // the last apply's story belongs to the last tree
  verified.value = [];
  busy.value = true;
  error.value = "";
  try {
    report.value = await api.fit(dir.value, { pattern: patternName.value || undefined });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function apply(): Promise<void> {
  if (!report.value) return;
  const steps = report.value.steps.length;
  if (!confirm(`Apply ${steps} step${steps === 1 ? "" : "s"}? A checkpoint branch records the tree as it is.`)) {
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const result = await api.fit(dir.value, {
      pattern: patternName.value || undefined,
      apply: true,
    });
    const failed = result.failures?.length ?? 0;
    toast(
      failed > 0 ? "error" : "success",
      failed > 0
        ? `${failed} step${failed === 1 ? "" : "s"} failed. See the plan.`
        : `Applied ${result.applied?.length ?? 0} steps. \`git switch ${result.checkpoint}\` reverts.`,
    );
    await plan(); // re-plan against the tree as it now stands
    checkpoint.value = result.checkpoint ?? "";
    verified.value = result.verified ?? [];
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

const moves = computed(() =>
  (report.value?.steps ?? []).filter((s): s is Extract<FitStep, { kind: "move" }> => s.kind === "move"),
);
const fixes = computed(() =>
  (report.value?.steps ?? []).filter((s): s is Extract<FitStep, { kind: "fix" }> => s.kind === "fix"),
);
const rewriteCount = computed(() => moves.value.reduce((n, move) => n + move.rewrites.length, 0));
const translations = computed(() =>
  (report.value?.steps ?? []).filter(
    (s): s is Extract<FitStep, { kind: "translate" }> => s.kind === "translate",
  ),
);
const translationKiB = computed(() =>
  Math.ceil(translations.value.reduce((n, step) => n + step.bytes, 0) / 1024),
);
const gitHint = computed(() => {
  switch (report.value?.git) {
    case "missing":
      return "Apply needs a git repository because the checkpoint branch is the undo.";
    case "dirty":
      return "The git tree is not clean. Commit or stash first.";
    default:
      return "";
  }
});
/** Beside the title once there is something to apply: the precondition, or that it holds. */
const gitLine = computed(() => {
  if (!report.value || report.value.steps.length === 0) return "";
  return gitHint.value || "The git tree is clean, so Apply is enabled.";
});
</script>

<template>
  <section>
    <div class="page-head">
      <div class="sub">
        <h1>Fit a project</h1>
        <span class="note">Plan the moves and fixes a pattern asks for, then apply them as one commit.</span>
      </div>
      <span v-if="gitLine" class="note">{{ gitLine }}</span>
    </div>

    <form class="panel toolbar" @submit.prevent="plan">
      <ProjectFields v-model:dir="dir" v-model:pattern="patternName" />
      <button class="primary" type="submit" :disabled="busy">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3.5 12h11" />
          <path d="m10.5 8 4 4-4 4" />
          <path d="M17.5 4.5h3v15h-3" />
        </svg>
        Plan
      </button>
      <button
        type="button"
        :disabled="busy || !report || report.steps.length === 0 || report.git !== 'clean'"
        :title="gitHint"
        @click="apply"
      >
        Apply{{ report && report.steps.length > 0 ? ` ${report.steps.length}` : "" }}
      </button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="report">
      <div class="stats" :class="{ five: translations.length > 0 }">
        <div class="stat">
          <span class="n" :class="{ warm: moves.length > 0 }">{{ moves.length }}</span>
          <span class="l">move{{ moves.length === 1 ? "" : "s" }}</span>
        </div>
        <div class="stat">
          <span class="n">{{ fixes.length }}</span>
          <span class="l">fix{{ fixes.length === 1 ? "" : "es" }}</span>
        </div>
        <div v-if="translations.length > 0" class="stat">
          <span class="n warm">{{ translations.length }}</span>
          <span class="l">translation{{ translations.length === 1 ? "" : "s" }}</span>
        </div>
        <div class="stat">
          <span class="n">{{ report.declined.length }}</span>
          <span class="l">left to you</span>
        </div>
        <div class="stat">
          <span class="l">against</span>
          <span class="n mono">{{ report.pattern }}</span>
        </div>
      </div>

      <p class="note">
        Apply runs behind a clean git tree and records a checkpoint branch, so the undo is one
        <code>git switch</code> away.
      </p>
      <p v-for="line in verified" :key="line" class="note">verified: {{ line }}</p>
      <p v-if="checkpoint" class="note">
        Checkpoint branch <code>{{ checkpoint }}</code> holds the tree as it was.
      </p>
      <p v-if="report.steps.length === 0" class="note">
        Nothing to fit: this project follows "{{ report.pattern }}".
      </p>

      <div v-if="report.diagnostics.length" class="callout">
        <strong>Pattern issues (fix the pattern, not the project)</strong>
        <ul>
          <li v-for="diagnostic in report.diagnostics" :key="diagnostic">{{ diagnostic }}</li>
        </ul>
      </div>

      <div class="panels">
        <div v-if="moves.length" class="panel">
          <div class="panel-head">
            <h3 class="warm">moves</h3>
            <span class="count">
              {{ moves.length }} move{{ moves.length === 1 ? "" : "s" }},
              {{ rewriteCount }} import rewrite{{ rewriteCount === 1 ? "" : "s" }}
            </span>
          </div>
          <table>
            <tbody>
              <template v-for="move in moves" :key="move.from">
                <tr class="row">
                  <td class="path">{{ move.from }} → {{ move.to }}</td>
                  <td>{{ move.reason }}</td>
                </tr>
                <tr v-for="rewrite in move.rewrites" :key="`${rewrite.file}:${rewrite.from}`" class="sub">
                  <td class="path">{{ rewrite.file }}</td>
                  <td>rewrites <code>"{{ rewrite.from }}"</code> → <code>"{{ rewrite.to }}"</code></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <div v-if="fixes.length" class="panel">
          <div class="panel-head">
            <h3>fixes</h3>
            <span class="count">{{ fixes.length }} fix{{ fixes.length === 1 ? "" : "es" }}</span>
          </div>
          <table>
            <tbody>
              <tr v-for="fix in fixes" :key="`${fix.path}:${fix.reason}`" class="row">
                <td class="path">{{ fix.path }}</td>
                <td>{{ fix.reason }}</td>
                <td class="actions"><span class="badge">{{ fix.plan.kind }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="translations.length" class="panel">
          <div class="panel-head">
            <h3 class="warm">translations</h3>
            <span class="count">
              {{ translations.length }} file{{ translations.length === 1 ? "" : "s" }}, {{ translationKiB }} KiB to the
              model under Apply; typecheck and test judge the result before any source is removed
            </span>
          </div>
          <table>
            <tbody>
              <tr v-for="step in translations" :key="step.from" class="row">
                <td class="path">{{ step.from }} → {{ step.to }}</td>
                <td>{{ step.reason }}</td>
                <td class="actions"><span class="badge">{{ step.language }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="report.declined.length" class="panel">
          <div class="panel-head">
            <h3>left to you</h3>
            <span class="count">{{ report.declined.length }} declined</span>
          </div>
          <table>
            <tbody>
              <tr v-for="item in report.declined" :key="`${item.path}:${item.message}`" class="row">
                <td class="path">{{ item.path }}</td>
                <td>
                  <div>{{ item.message }}</div>
                  <div v-if="item.suggestion" class="note">
                    ai ({{ item.suggestion.model }}) suggests
                    <code>{{ item.suggestion.pick }}</code>
                    <template v-if="item.suggestion.why">: {{ item.suggestion.why }}</template>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <div v-else-if="!error" class="empty">
      <img alt="" src="/logo.svg" />
      <h2>Nothing planned yet</h2>
      <p>
        Fit previews every move and fix first. <code>Apply</code> only runs behind a clean git
        tree and a checkpoint branch.
      </p>
    </div>
  </section>
</template>
