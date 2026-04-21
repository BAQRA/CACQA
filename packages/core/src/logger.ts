import { pino, type Logger as PinoLogger, type LoggerOptions } from 'pino';

export type Logger = PinoLogger;

/**
 * Structured logger built on pino. Every log line carries a correlation id
 * (sessionId, roundId, jobId) so we can trace a failure across worker, queue,
 * and LLM calls without a separate tracer in the MVP.
 *
 * Pretty-printing is enabled in development only — pino-pretty should not be
 * loaded in production images (higher CPU cost, color codes clutter log drains).
 */
export function createLogger(
  bindings: Record<string, unknown> = {},
  options: { level?: string; pretty?: boolean } = {},
): Logger {
  const level = options.level ?? process.env['LOG_LEVEL'] ?? 'info';
  const pretty = options.pretty ?? process.env['NODE_ENV'] !== 'production';

  const base: LoggerOptions = {
    level,
    base: { service: bindings['service'] ?? 'cacqa' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        '*.password',
        '*.token',
        '*.apiKey',
        '*.secret',
        'headers.authorization',
        'headers.cookie',
      ],
      censor: '[REDACTED]',
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  };

  return pino(base).child(bindings);
}
