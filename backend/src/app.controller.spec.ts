import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('capabilities', () => {
    it('reports implemented status without implying business modules are ready', () => {
      expect(appController.getCapabilities()).toEqual({
        modules: [
          { id: 'command-center', status: 'partial' },
          { id: 'commerce', status: 'partial' },
          { id: 'ai-studio', status: 'partial' },
          { id: 'ai-agents', status: 'partial' },
          { id: 'market-intelligence', status: 'partial' },
          { id: 'automation', status: 'partial' },
          { id: 'identity', status: 'partial' },
        ],
      });
    });
  });
});
