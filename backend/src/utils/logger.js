import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

const pinoInstance = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'confirm_password',
      'token',
      'access_token',
      'accessToken',
      'meta_capi_access_token',
      // Supabase service-role credentials (Lyfe + mktr-leads adapters) — never
      // let a logged request/err object leak them.
      'apikey',
      'headers.apikey',
      'serviceRoleKey',
      // DNC Registry: the RSA signing key + the signed request signature/header.
      'privateKey',
      'DNC_PRIVATE_KEY',
      'appSignature',
      'signature',
      'authorization',
      'secret',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

/**
 * The house logging convention is `logger.warn('message', { meta })`. Raw
 * pino's contract is the REVERSE — (mergingObject, message) — and when the
 * first argument is a string with no printf placeholders, pino silently
 * DROPS every additional argument from JSON output. Net effect: every
 * campaignId / prospectId / error field attached since the beginning was
 * missing from production logs, while dev's pino-pretty rendered the
 * interpolation args and masked it (verified empirically against a capture
 * stream).
 *
 * This adapter makes the house convention real: ('msg', {meta}) is reordered
 * to pino's (meta, 'msg'); ('msg', Error) wraps the error as { err } so the
 * stdSerializer applies; pino-native (obj, 'msg') and printf-style calls
 * pass through untouched. Exported as a factory so the unit test can pin the
 * behaviour against a capture stream.
 *
 * @param {import('pino').Logger} base
 */
export function adaptHouseConvention(base) {
  const adapt = (method) => (a, b, ...rest) => {
    if (typeof a === 'string' && b !== undefined && rest.length === 0) {
      if (b instanceof Error) return base[method]({ err: b }, a);
      if (b !== null && typeof b === 'object') return base[method](b, a);
    }
    return base[method](a, b, ...rest);
  };
  return {
    fatal: adapt('fatal'),
    error: adapt('error'),
    warn: adapt('warn'),
    info: adapt('info'),
    debug: adapt('debug'),
    trace: adapt('trace'),
    child: (bindings) => adaptHouseConvention(base.child(bindings)),
    get level() { return base.level; },
  };
}

export const logger = adaptHouseConvention(pinoInstance);

// pino-http (server_internal) needs the REAL pino instance — the adapter is
// for app code only.
export { pinoInstance };
