/**
 * Tagged error hierarchy. All adapters return errors that extend AppError so
 * higher layers can pattern-match on `.kind` without instanceof chains.
 *
 * Rule of thumb: add a new kind when callers need to branch on it. Otherwise,
 * wrap the underlying cause in one of the existing kinds with a clear message.
 */
export type ErrorKind =
  | 'BrowserError'
  | 'VisionError'
  | 'LLMError'
  | 'OracleError'
  | 'StorageError'
  | 'ConfigError'
  | 'TimeoutError'
  | 'ValidationError'
  | 'UnknownError';

export abstract class AppError extends Error {
  public abstract readonly kind: ErrorKind;
  public override readonly cause: unknown | undefined;
  public readonly context: Readonly<Record<string, unknown>> | undefined;

  public constructor(message: string, options?: { cause?: unknown; context?: Record<string, unknown> }) {
    super(message);
    this.name = this.constructor.name;
    this.cause = options?.cause;
    this.context = options?.context ? Object.freeze({ ...options.context }) : undefined;
    // Preserves the stack trace in V8 and falls back gracefully elsewhere.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  public toJSON(): Record<string, unknown> {
    return {
      kind: this.kind,
      name: this.name,
      message: this.message,
      context: this.context,
      cause: this.cause instanceof Error ? { name: this.cause.name, message: this.cause.message } : this.cause,
    };
  }
}

export class BrowserError extends AppError {
  public readonly kind = 'BrowserError' as const;
}

export class VisionError extends AppError {
  public readonly kind = 'VisionError' as const;
}

export class LLMError extends AppError {
  public readonly kind = 'LLMError' as const;
}

export class OracleError extends AppError {
  public readonly kind = 'OracleError' as const;
}

export class StorageError extends AppError {
  public readonly kind = 'StorageError' as const;
}

export class ConfigError extends AppError {
  public readonly kind = 'ConfigError' as const;
}

export class TimeoutError extends AppError {
  public readonly kind = 'TimeoutError' as const;
}

export class ValidationError extends AppError {
  public readonly kind = 'ValidationError' as const;
}

export class UnknownError extends AppError {
  public readonly kind = 'UnknownError' as const;
}

/**
 * Coerces an arbitrary thrown value into an AppError. Use at adapter boundaries
 * where third-party libs may throw anything.
 */
export function toAppError(value: unknown, fallbackMessage = 'Unexpected error'): AppError {
  if (value instanceof AppError) {
    return value;
  }
  if (value instanceof Error) {
    return new UnknownError(value.message, { cause: value });
  }
  return new UnknownError(fallbackMessage, { cause: value });
}
