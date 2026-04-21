import { Module } from '@nestjs/common';

import { RoundsController } from './rounds.controller.js';
import { ScreenshotsController } from './screenshots.controller.js';
import { SessionsController } from './sessions.controller.js';
import { sessionRepositoryProvider } from './sessions.repository.provider.js';
import { SessionsService } from './sessions.service.js';

@Module({
  controllers: [SessionsController, RoundsController, ScreenshotsController],
  providers: [sessionRepositoryProvider, SessionsService],
  exports: [SessionsService, sessionRepositoryProvider],
})
export class SessionsModule {}
