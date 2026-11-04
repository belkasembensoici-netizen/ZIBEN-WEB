import { Module } from '@nestjs/common';
import {
  WebhookDeliveryService,
  WebhookSignatureService,
} from './webhook-signature.js';

@Module({
  providers: [WebhookSignatureService, WebhookDeliveryService],
  exports: [WebhookDeliveryService, WebhookSignatureService],
})
export class AutomationModule {}
