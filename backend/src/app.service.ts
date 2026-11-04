import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  getCapabilities() {
    return {
      modules: [
        { id: 'command-center', status: 'partial' },
        { id: 'commerce', status: 'partial' },
        { id: 'ai-studio', status: 'partial' },
        { id: 'ai-agents', status: 'partial' },
        { id: 'market-intelligence', status: 'partial' },
        { id: 'automation', status: 'partial' },
        { id: 'identity', status: 'partial' },
      ],
    } as const;
  }
}
