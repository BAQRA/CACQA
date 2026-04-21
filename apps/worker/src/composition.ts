import { PlaywrightBrowserDriverFactory } from '@cacqa/browser';
import { loadEnv, type Env } from '@cacqa/config/env';
import {
  createLogger,
  type ArtifactStore,
  type BrowserDriverFactory,
  type LLMProvider,
  type Logger,
  type Oracle,
  type SessionRepository,
  type VisionService,
} from '@cacqa/core';
import { createLLMProvider } from '@cacqa/llm';
import { createDefaultOracle } from '@cacqa/oracle';
import { FilesystemSessionRepository } from '@cacqa/storage';
import { TesseractVisionService } from '@cacqa/vision';

import { LocalArtifactStore } from './infra/local-artifact-store.js';

export interface WorkerContainer {
  readonly env: Env;
  readonly logger: Logger;
  readonly browserFactory: BrowserDriverFactory;
  readonly vision: VisionService;
  readonly llm: LLMProvider;
  readonly oracle: Oracle;
  readonly artifacts: ArtifactStore;
  readonly repository: SessionRepository;
  shutdown(): Promise<void>;
}

/**
 * Composition root. The ONLY file in the worker that knows about concrete
 * adapter classes. Tests build their own container with stubs.
 */
export function buildContainer(): WorkerContainer {
  const env = loadEnv();
  const logger = createLogger({ service: 'worker' }, { level: env.LOG_LEVEL });

  const browserFactory = new PlaywrightBrowserDriverFactory(logger, env.WORKER_HEADLESS);
  const vision = new TesseractVisionService({ logger });
  const llm = createLLMProvider({ env, logger });
  const oracle = createDefaultOracle();
  const artifacts = new LocalArtifactStore({ rootDir: env.WORKER_ARTIFACT_DIR, logger });
  const repository = new FilesystemSessionRepository({ rootDir: env.WORKER_ARTIFACT_DIR, logger });

  return {
    env,
    logger,
    browserFactory,
    vision,
    llm,
    oracle,
    artifacts,
    repository,
    async shutdown() {
      await Promise.allSettled([
        browserFactory.shutdown(),
        vision.dispose(),
      ]);
    },
  };
}
