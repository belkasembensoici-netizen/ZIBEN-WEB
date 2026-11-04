import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller({
  path: '',
  version: '1',
})
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('capabilities')
  getCapabilities() {
    return this.appService.getCapabilities();
  }
}
