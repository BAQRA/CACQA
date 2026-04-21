/**
 * Re-exports neverthrow for ergonomic typed-error handling across the codebase.
 *
 * Convention: any function that can fail in a predictable, domain-relevant way
 * returns `Result<T, E>` where `E extends AppError`. Throwing is reserved for
 * programmer errors (invariant violations) and truly unrecoverable conditions.
 */
export {
  ok,
  err,
  Result,
  ResultAsync,
  okAsync,
  errAsync,
  fromPromise,
  fromThrowable,
  fromAsyncThrowable,
} from 'neverthrow';
