import * as Sentry from '@sentry/node';
import { scrubEvent, scrubBreadcrumb } from './sentryScrub.js';

let initialized = false;

/**
 * Initialize Sentry once, with the shared PII scrubbers.
 *
 * Extracted from server.js so standalone entrypoints (e.g. cron scripts) get the
 * SAME config + scrubbing as the web service, instead of a bare `Sentry.init()`
 * that would ship unscrubbed PII. No-op when `SENTRY_DSN` is unset or when
 * already initialized in this process.
 *
 * @param {object} [opts]
 * @param {string} [opts.service='mktr-backend'] value for the `service` tag,
 *   used to distinguish events in the shared Sentry project.
 * @returns {typeof Sentry} the Sentry module (so callers can `captureException`).
 */
export function initSentry({ service = 'mktr-backend' } = {}) {
  if (initialized) return Sentry;
  if (!process.env.SENTRY_DSN) return Sentry;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    initialScope: {
      tags: { service },
    },
  });

  initialized = true;
  return Sentry;
}

export { Sentry };
