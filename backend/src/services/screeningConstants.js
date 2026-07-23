/**
 * Screening-gate constants — deliberately DEPENDENCY-FREE so any module
 * (prospectService, entitlementService, dashboards, tests) can import the
 * reason list without pulling the screening service graph (models, credits,
 * webhooks) into its own module graph / jest mock registry.
 * State machine: docs/plans/retell-screening-calls.md §2.2.
 */
export const SCREENING_REASONS = ['screening_pending', 'screening_failed', 'screening_unreachable'];
