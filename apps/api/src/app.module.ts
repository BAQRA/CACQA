import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { SessionsModule } from './sessions/sessions.module.js';

@Module({
  imports: [SessionsModule],
  controllers: [HealthController],
})
export class AppModule {}
