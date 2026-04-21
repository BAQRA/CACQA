import { type SessionSpec } from '@cacqa/core';

export const QUEUE_NAME = 'cacqa.sessions';

export interface RunSessionJobPayload {
  readonly spec: SessionSpec;
}

export type JobName = 'run-session';
