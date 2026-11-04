import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CoreModule } from './core/core.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AutomationModule } from './automation/automation.module.js';
import { MarketIntelligenceModule } from './market-intelligence/market-intelligence.module.js';
import { AIStudioModule } from './ai-studio/ai-studio.module.js';
import { CommerceModule } from './commerce/commerce.module.js';
import { IdentityModule } from './identity/identity.module.js';

import { loadObserveModule } from './observe-config.js';

const { configuration: observeConfiguration, observeModule } =
  await loadObserveModule(() => import('@nestjs/observe'));
const { createObserveModule } = observeModule;
export const { ObserveModule, ObserveInstrument } = createObserveModule({
  sourceContext: false,
});

@Module({
  imports: [
    ObserveModule.forRoot({
      enabled: observeConfiguration.enabled,
      appKey: observeConfiguration.appKey,
      appSecret: observeConfiguration.appSecret,
      endpoint: observeConfiguration.endpoint,
      forwardLogs: false,
      http: { capture: false },
      serviceId: 'backend',
    }),
    CoreModule,
    DatabaseModule,
    HealthModule,
    MarketIntelligenceModule,
    AutomationModule,
    AIStudioModule,
    CommerceModule,
    IdentityModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
