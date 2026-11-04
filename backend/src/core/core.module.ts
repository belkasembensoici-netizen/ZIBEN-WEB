import { Module } from '@nestjs/common';
import { CoreController } from './core.controller.js';

@Module({
  controllers: [CoreController]
})
export class CoreModule {}
