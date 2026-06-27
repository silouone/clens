// ── Client feature flags ────────────────────────────────────────────
//
// Single-source toggles for half-baked / experimental UI surfaces. Flipping
// a flag here should be the ONLY change required to surface (or hide) the
// associated feature — no other code is deleted, so revival is one line.

/**
 * Work Units is a dead/half-baked concept right now (to be reworked for
 * spec-driven development later). All UI entry points are gated on this flag,
 * but the underlying components, routes, stores, and server logic remain intact.
 *
 * Flip to `true` to fully restore the feature.
 */
export const SHOW_WORK_UNITS = false;
