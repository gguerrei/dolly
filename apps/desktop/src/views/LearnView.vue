<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { api, type Proposal, watchLearning } from "../api";
import ProjectFields from "../components/ProjectFields.vue";
import { toast } from "../lib/toasts";

const dir = ref(""); // remembered by ProjectFields
const patternName = ref("");
const proposals = ref<Proposal[]>([]);
const changed = ref<string[]>([]);
const learned = ref(""); // the pattern the daemon resolved, for the "against" tile
/** The review so far, keyed by proposal identity; a proposal the watcher drops loses its decision too. */
const decisions = ref<Record<string, "accepted" | "skipped">>({});
const watching = ref(false);
const drafting = ref(false);
const writing = ref(false);
const error = ref("");
let dispose: (() => void) | null = null;


/** Same proposal, same key, across re-learns. */
function keyOf(proposal: Proposal): string {
  return `${proposal.path.join(".")}=${JSON.stringify(proposal.value)}`;
}

function startWatching(): void {
  if (!dir.value) {
    error.value = "Point dolly at a project directory first.";
    return;
  }
  error.value = "";
  proposals.value = [];
  decisions.value = {};
  dispose = watchLearning(
    dir.value,
    patternName.value || undefined,
    (report) => {
      // Facet proposals are the watcher's to replace; the model's drafts stay until written.
      const drafted = proposals.value.filter((p) => p.path[0] === "prose");
      proposals.value = [...report.proposals, ...drafted];
      changed.value = report.changed;
      learned.value = report.pattern;
    },
    (message) => {
      error.value = message;
    },
  );
  watching.value = true;
}

/** Stops the watcher, then asks the model once, which is where the AI layer enters learn. */
async function stopWatching(): Promise<void> {
  dispose?.();
  dispose = null;
  watching.value = false;
  if (changed.value.length === 0) return;
  drafting.value = true;
  try {
    const drafted = await api.learnDraft(
      dir.value,
      patternName.value || undefined,
      changed.value,
      proposals.value,
    );
    proposals.value = [...proposals.value, ...drafted];
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    drafting.value = false;
  }
}

function decide(proposal: Proposal, decision: "accepted" | "skipped"): void {
  const key = keyOf(proposal);
  decisions.value =
    decisions.value[key] === decision
      ? Object.fromEntries(Object.entries(decisions.value).filter(([k]) => k !== key))
      : { ...decisions.value, [key]: decision };
}

const accepted = computed(() => proposals.value.filter((p) => decisions.value[keyOf(p)] === "accepted"));
const skipped = computed(() => proposals.value.filter((p) => decisions.value[keyOf(p)] === "skipped"));

async function write(): Promise<void> {
  if (accepted.value.length === 0) return;
  writing.value = true;
  error.value = "";
  try {
    const result = await api.learnWrite(dir.value, patternName.value || undefined, accepted.value);
    toast(
      "success",
      `Learned ${result.written} change${result.written === 1 ? "" : "s"} into "${result.pattern}".`,
    );
    // What was written is no longer a proposal; the watcher re-learns the rest on its next pass.
    const written = new Set(accepted.value.map(keyOf));
    proposals.value = proposals.value.filter((p) => !written.has(keyOf(p)));
    decisions.value = Object.fromEntries(
      Object.entries(decisions.value).filter(([key]) => !written.has(key)),
    );
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    writing.value = false;
  }
}

/** A proposal's diff as lines the template can mark up; a captured file's diff leads with its path. */
function diffLines(proposal: Proposal): { kind: "file" | "add" | "del" | "ctx"; text: string }[] {
  return proposal.diff.split("\n").map((line, index) => {
    if (index === 0 && proposal.files && !line.startsWith("+") && !line.startsWith("-")) {
      return { kind: "file", text: line };
    }
    if (line.startsWith("+")) return { kind: "add", text: line };
    if (line.startsWith("-")) return { kind: "del", text: line };
    return { kind: "ctx", text: line };
  });
}

const primary = computed(() => {
  if (watching.value) return "Stop watching";
  return proposals.value.length > 0 ? "Watch again" : "Learn";
});

onBeforeUnmount(() => dispose?.());
</script>

<template>
  <section>
    <div class="page-head">
      <div class="sub">
        <h1>Learn from a project</h1>
        <span class="note">
          dolly watches the project and proposes pattern edits as it changes. Nothing is written
          until you accept it.
        </span>
      </div>
      <span v-if="watching" class="watching">
        <span class="dot" aria-hidden="true"></span>
        watching{{ changed.length ? `, ${changed.length} file${changed.length === 1 ? "" : "s"} changed` : "" }}
      </span>
      <span v-else-if="drafting" class="watching">
        <span class="dot" aria-hidden="true"></span>
        drafting conventions
      </span>
      <span v-else class="note">Same proposals as <code>dolly learn</code> in that directory</span>
    </div>

    <form class="panel toolbar" @submit.prevent="watching ? stopWatching() : startWatching()">
      <ProjectFields v-model:dir="dir" v-model:pattern="patternName" />
      <button :class="{ primary: !watching }" type="submit" :disabled="drafting || writing">
        <svg v-if="!watching" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3.5 5.5h5.5a3 3 0 0 1 3 3v10.5a2 2 0 0 0-2-2h-6.5z" />
          <path d="M20.5 5.5H15a3 3 0 0 0-3 3v10.5a2 2 0 0 1 2-2h6.5z" />
        </svg>
        {{ primary }}
      </button>
      <button
        :class="{ primary: watching || accepted.length > 0 }"
        type="button"
        :disabled="accepted.length === 0 || writing || drafting"
        :title="accepted.length === 0 ? 'Accept a proposal first' : ''"
        @click="write"
      >
        Write{{ accepted.length > 0 ? ` ${accepted.length} accepted` : "" }}
      </button>
    </form>

    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="proposals.length > 0">
      <div class="stats">
        <div class="stat">
          <span class="n">{{ proposals.length }}</span>
          <span class="l">proposal{{ proposals.length === 1 ? "" : "s" }}</span>
        </div>
        <div class="stat">
          <span class="n">{{ accepted.length }}</span>
          <span class="l">accepted</span>
        </div>
        <div class="stat">
          <span class="n">{{ skipped.length }}</span>
          <span class="l">skipped</span>
        </div>
        <div class="stat">
          <span class="l">against</span>
          <span class="n mono">{{ learned }}</span>
        </div>
      </div>

      <div class="panels">
        <div
          v-for="proposal in proposals"
          :key="keyOf(proposal)"
          class="panel"
          :class="{ skipped: decisions[keyOf(proposal)] === 'skipped' }"
        >
          <div class="panel-head">
            <div class="actions-row" style="gap: 10px">
              <span v-if="proposal.path[0] === 'prose'" class="label">conventions</span>
              <span v-else class="label">{{ proposal.path.join(".") }}</span>
              <span v-if="proposal.path[0] === 'prose'" class="badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width: 12px; height: 12px; margin-right: 5px">
                  <path d="M12 4.5v3M12 16.5v3M4.5 12h3M16.5 12h3M6.7 6.7l2.1 2.1M15.2 15.2l2.1 2.1M6.7 17.3l2.1-2.1M15.2 8.8l2.1-2.1" />
                </svg>
                {{ proposal.reason }}
              </span>
              <span v-else class="reason">{{ proposal.reason }}</span>
            </div>
            <div class="pick">
              <button
                class="small"
                :class="decisions[keyOf(proposal)] === 'accepted' ? 'primary' : 'ghost'"
                type="button"
                :aria-pressed="decisions[keyOf(proposal)] === 'accepted'"
                @click="decide(proposal, 'accepted')"
              >
                {{ decisions[keyOf(proposal)] === "accepted" ? "Accepted" : "Accept" }}
              </button>
              <button
                class="small"
                :class="decisions[keyOf(proposal)] === 'skipped' ? '' : 'ghost'"
                type="button"
                :aria-pressed="decisions[keyOf(proposal)] === 'skipped'"
                @click="decide(proposal, 'skipped')"
              >
                {{ decisions[keyOf(proposal)] === "skipped" ? "Skipped" : "Skip" }}
              </button>
            </div>
          </div>
          <pre class="diff"><span v-for="(line, index) in diffLines(proposal)" :key="index" :class="line.kind === 'file' ? 'file' : `ln ${line.kind}`">{{ line.text }}</span></pre>
        </div>
      </div>
    </template>

    <div v-else-if="!error && !watching" class="empty">
      <img alt="" src="/logo.svg" />
      <h2>Nothing learned yet</h2>
      <p>
        Point dolly at the project you extracted the pattern from, or the one you treat as
        canonical. Edits there become proposals here.
      </p>
    </div>

    <div v-else-if="!error" class="empty">
      <img alt="" src="/logo.svg" />
      <h2>Watching</h2>
      <p>The project matches its pattern so far. Edit it, and proposals appear here.</p>
    </div>
  </section>
</template>
