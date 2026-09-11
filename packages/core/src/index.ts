/**
 * The deliberate public surface of @dollysheep/core: the contract the CLI (and
 * later the daemon and GUI) binds to. One entry point per verb; everything
 * not named here is internal and free to move. Tests reach past this barrel
 * on purpose.
 */

// The AI layer's switch and status. Off means null, never an error.
export {
  type AiClient,
  type AiProviderStatus,
  type AiStatus,
  AiUsageError,
  activeAi,
  aiOff,
  aiProviders,
  aiStatus,
  connectAi,
  useAi,
  verifyAi,
} from "./ai/ai";
export { type AssistedCheckOptions, assistedCheck } from "./ai/check";
export { draftConventions } from "./ai/conventions";
export { assistedFit } from "./ai/placement";
export { AiProviderError, type AiRequest, PROVIDERS, type ProviderId } from "./ai/providers";
export { assistedFitApply } from "./ai/translation";
// Operations: the future daemon's RPC surface
export {
  applyFitPlan,
  type DeclinedItem,
  type FitApplyResult,
  FitGitError,
  type FitPlan,
  type FitStep,
  fitApply,
  fitProject,
  gitStateOf,
  type MoveStep,
  type PlacementSuggestion,
  type TranslateStep,
  type Translator,
} from "./apply/fit";
export { type ScaffoldReport, scaffoldProject, TargetNotEmptyError } from "./apply/new";
export {
  type CheckReport,
  type ConventionFinding,
  type ConventionsReport,
  checkProject,
  watchProject,
} from "./check/check";
export type { FixPlan } from "./check/fix";
export { RULE_IDS, type RuleId, type Violation } from "./check/rule";
export {
  exportBundle,
  InvalidBundleError,
  importBundle,
  PatternExistsError,
} from "./export/bundle";
export {
  EXPORT_TARGETS,
  ExportExistsError,
  type ExportTarget,
  exportPattern,
  type RenderedExport,
  renderExport,
  type TextTarget,
} from "./export/export";
export {
  type ExtractResult,
  extractFromRepos,
  extractPattern,
  saveExtractedPattern,
} from "./extract/extract";
export {
  draftDocument,
  type LearningWatch,
  learnDrift,
  type Proposal,
  pathLabel,
  renderProposal,
  saveLearned,
  UnsafePatternPathError,
  watchLearning,
} from "./learn/learn";
export {
  editMarker,
  ignorePaths,
  linkProject,
  MARKER_FILE,
  type Marker,
  type MarkerEdit,
  MarkerError,
  type PatternRef,
  pruneSources,
  type RuleSetting,
  readMarker,
  readPatternMarker,
  resolvePattern,
  VENDOR_DIR,
} from "./marker";
// Pattern model
export {
  type PatternDocument,
  PatternParseError,
  parsePatternDocument,
  serializePatternDocument,
} from "./pattern/document";
export {
  type CaseStyle,
  type Commands,
  type Commits,
  type Dependencies,
  facetNames,
  isSafePatternPath,
  type Languages,
  type LayoutEntry,
  type Naming,
  type Pattern,
  patternSchema,
  type Releases,
  type Scaffold,
  type Testing,
  type Toolchain,
} from "./pattern/schema";
// Storage
export {
  dollyHome,
  InvalidPatternFileError,
  InvalidPatternNameError,
  PatternNotFoundError,
  PatternStore,
  type PatternSummary,
} from "./store";
