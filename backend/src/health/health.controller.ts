import { Controller, Get, Header, HttpCode, HttpStatus } from '@nestjs/common';
import { HealthService } from './health.service.js';

@Controller({
  path: 'health',
  version: '1',
})
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  getLiveness(): { status: 'alive' } {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async getReadiness(): Promise<{
    status: 'ready';
    checks: { database: 'available' };
  }> {
    return this.healthService.getReadiness();
  }
}
