import { Module } from '@nestjs/common';
import { CommerceDomainService } from './commerce-domain.js';

@Module({
  providers: [CommerceDomainService],
  exports: [CommerceDomainService],
})
export class CommerceModule {}
