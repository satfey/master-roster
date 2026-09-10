/**
 * Store-level constants, mirrored from the backend so the UI never states a
 * different rule than the one the roster generator and validator enforce.
 *
 * Source of truth: backend/src/services/storeOperatingHours.js
 *   OPERATING_HOURS = { start: 9, end: 22 }
 *   CLOSING_COVERAGE_STAFF_COUNT = 2
 *
 * These are for LABELS ONLY. No screen may decide whether a roster is
 * compliant from these values — that verdict comes from POST /roster/validate
 * (see lib/rosterValidationAdapter.js). Keeping a second copy of the rules in
 * the browser is exactly how the two drift apart.
 */
export const STORE_COVERAGE = {
  openingTime: '09:00',
  closingTime: '22:00',
  /** The backend guarantees this many people through the closing hour. */
  minClosers: 2,
  minOpeners: 1
};

/**
 * There is deliberately no recommendedHeadcount() here.
 *
 * The earlier version of this file mapped daily sales to a headcount with
 * hardcoded bands (<=15,000 -> 3 people, and so on) and capped every store at
 * 5 staff. The real rule is per-hour, per-store, and uses the store's own
 * configured target productivity:
 *
 *   requiredHeadcount     = max(min_staff_per_shift, 1)
 *   maxJustifiedHeadcount = max(floor(sales / target_productivity), requiredHeadcount)
 *
 * (backend/src/services/laborDemandService.js). Bands could not reproduce that
 * for any store, so the screens now show the backend's own hour-by-hour
 * under/overstaffing result instead of a locally guessed target.
 */
