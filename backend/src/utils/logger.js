import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
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
