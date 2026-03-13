export { AttentionManager } from "./manager.js";
export type {
  AttentionItem,
  AttentionType,
  AttentionSeverity,
  AttentionConfig,
  AttentionRuleConfig,
  AttentionQuery,
} from "./types.js";
export { defaultAttentionConfig } from "./types.js";
export { evaluateRules, evaluateStaleIssues, evaluatePrNeedsReview } from "./rules.js";
export { default as attentionPlugin } from "./plugin.js";
