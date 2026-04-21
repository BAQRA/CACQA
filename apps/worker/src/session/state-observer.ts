import {
  errAsync,
  ResultAsync,
  toAppError,
  UnknownError,
  type AppError,
  type ArtifactStore,
  type BrowserDriver,
  type GameState,
  type LLMProvider,
  type Logger,
  type SessionId,
  type VisionService,
} from '@cacqa/core';

export interface ObserveInput {
  readonly sessionId: SessionId;
  readonly roundIndex: number;
  readonly priorState: GameState | null;
  /**
   * Short slug identifying what this observation captured (e.g. "initial",
   * "pre-flight-2", "after-place-bet"). Included in the artifact path so
   * multiple observations inside a round don't overwrite each other.
   */
  readonly label?: string;
}

export interface Observation {
  readonly state: GameState;
  readonly screenshotKey: string;
}

/**
 * Captures one observation cycle: screenshot -> OCR -> LLM extraction -> persist.
 * The output is a normalized GameState the oracle and scenario generator both
 * consume.
 */
export class StateObserver {
  public constructor(
    private readonly browser: BrowserDriver,
    private readonly vision: VisionService,
    private readonly llm: LLMProvider,
    private readonly artifacts: ArtifactStore,
    private readonly logger: Logger,
  ) {}

  public observe(input: ObserveInput): ResultAsync<Observation, AppError> {
    const log = this.logger.child({ sessionId: input.sessionId, roundIndex: input.roundIndex });
    const label = (input.label ?? 'snapshot').replace(/[^a-z0-9._-]+/gi, '-');

    return this.browser
      .screenshot()
      .mapErr((e) => e as AppError)
      .andThen((shot) => {
        const key = `sessions/${input.sessionId}/rounds/${input.roundIndex}/${label}.png`;
        return this.artifacts
          .put(key, shot.buffer, 'image/png')
          .mapErr((e) => e as AppError)
          .map(() => ({ shot, key }));
      })
      .andThen(({ shot, key }) =>
        this.vision
          .extractText(shot.buffer)
          .mapErr((e) => e as AppError)
          .andThen((ocr) =>
            this.llm
              .extractState({
                screenshot: shot.buffer,
                ocrHint: ocr.fullText,
                priorState: input.priorState,
              })
              .mapErr((e) => e as AppError)
              .map(({ state, usage }) => {
                log.debug({ usage, ocrChars: ocr.fullText.length }, 'observation captured');
                const finalized: GameState = { ...state, ocrText: ocr.fullText, screenshotRef: key };
                return { state: finalized, screenshotKey: key } satisfies Observation;
              }),
          ),
      );
  }
}
