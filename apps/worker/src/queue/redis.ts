import { Redis, type RedisOptions } from 'ioredis';

/**
 * BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`
 * for the connection it polls — without these the worker will retry forever
 * on transient errors. We isolate the connection here so the rest of the app
 * doesn't need to know.
 */
export function createRedisConnection(url: string, extra: RedisOptions = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...extra,
  });
}
