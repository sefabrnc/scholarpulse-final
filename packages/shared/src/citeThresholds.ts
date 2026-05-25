/** Shared cite-edge confidence thresholds (coord-only stack, no text storage). */

/** Minimum cross-encoder score to persist an edge (precision-first gate). */
export const CITE_CE_THRESHOLD = 0.87;

/** ce_score >= this maps to confidence_tier "high". */
export const CITE_HIGH_CONFIDENCE_THRESHOLD = 0.95;

/** Inclusive lower bound for confidence_tier "medium". */
export const CITE_MEDIUM_CONFIDENCE_MIN = CITE_CE_THRESHOLD;

/** Edges below CITE_CE_THRESHOLD are not written to D1. */
export const CITE_LOW_CONFIDENCE_MAX = CITE_CE_THRESHOLD - 0.0001;
