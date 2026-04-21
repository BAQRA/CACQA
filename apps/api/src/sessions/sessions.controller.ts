import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import {
  type Failure,
  type SessionId,
  type SessionRecord,
  type SessionRepository,
} from '@cacqa/core';

import { ZodValidationPipe } from '../zod-validation.pipe.js';

import {
  CreateSessionRequestSchema,
  type CreateSessionRequest,
  type CreateSessionResponse,
} from './sessions.dto.js';
import { SESSION_REPOSITORY } from './sessions.repository.provider.js';
import { SessionsService } from './sessions.service.js';

/**
 * DTO shapes returned to the dashboard. We intentionally do NOT return the
 * raw SessionRecord because `Date` values don't serialize cleanly over JSON
 * in a way Next.js server components can round-trip. Everything here is
 * ISO-string dates and plain objects.
 */
interface SessionDto {
  readonly sessionId: string;
  readonly organizationId: string;
  readonly targetUrl: string;
  readonly status: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly roundsCompleted: number;
  readonly failureCount: number;
  readonly maxRounds: number;
}

interface FailureDto extends Omit<Failure, 'observedAt'> {
  readonly observedAt: string;
}

function toSessionDto(r: SessionRecord): SessionDto {
  return {
    sessionId: r.spec.sessionId,
    organizationId: r.spec.organizationId,
    targetUrl: r.spec.targetUrl,
    status: r.status,
    startedAt: r.startedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    roundsCompleted: r.roundsCompleted,
    failureCount: r.failureCount,
    maxRounds: r.spec.maxRounds,
  };
}

@Controller('sessions')
export class SessionsController {
  // tsx/esbuild does not emit decorator metadata, so Nest can't resolve class-
  // type injections automatically. We wire every provider with an explicit
  // @Inject token — works regardless of the transpiler.
  public constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(SESSION_REPOSITORY) private readonly repository: SessionRepository,
  ) {}

  @Post()
  @HttpCode(202)
  @UsePipes(new ZodValidationPipe(CreateSessionRequestSchema))
  public async create(@Body() body: CreateSessionRequest): Promise<CreateSessionResponse> {
    return this.sessions.createSession(body);
  }

  @Get()
  public async list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ items: SessionDto[] }> {
    const result = await this.repository.list({
      limit: limit ? Math.min(500, Math.max(1, Number(limit))) : 50,
      offset: offset ? Math.max(0, Number(offset)) : 0,
    });
    if (result.isErr()) {
      throw new NotFoundException('Sessions store unavailable');
    }
    return { items: result.value.map(toSessionDto) };
  }

  @Get(':id')
  public async byId(@Param('id') id: string): Promise<SessionDto> {
    const result = await this.repository.findById(id as SessionId);
    if (result.isErr() || !result.value) {
      throw new NotFoundException(`Session not found: ${id}`);
    }
    return toSessionDto(result.value);
  }

  @Get(':id/failures')
  public async failures(@Param('id') id: string): Promise<{ items: FailureDto[] }> {
    const result = await this.repository.listFailures(id as SessionId);
    if (result.isErr()) {
      throw new NotFoundException(`Session not found: ${id}`);
    }
    const items: FailureDto[] = result.value.map((f) => ({
      ...f,
      observedAt: f.observedAt.toISOString(),
    }));
    return { items };
  }
}
