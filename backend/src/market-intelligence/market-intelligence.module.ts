import { Module } from '@nestjs/common';
import { MarketEvidenceService } from './market-evidence.js';

@Module({
  providers: [MarketEvidenceService],
  exports: [MarketEvidenceService],
})
export class MarketIntelligenceModule {}
