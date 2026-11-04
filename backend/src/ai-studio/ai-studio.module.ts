import { Module } from '@nestjs/common';
import {
  AGENT_APPROVAL_VERIFIER,
  AGENT_DEFINITION_STORE,
  AGENT_HISTORY_STORE,
  AGENT_MEMORY,
  AgentExecutionService,
  AgentToolRegistry,
  type AgentExecutionHistoryStore,
} from './agent-engine.js';
import {
  AI_APPROVAL_VERIFIER,
  AI_EXECUTION_TIMEOUT_MS,
  AIExecutionService,
} from './ai-execution.js';
import {
  createOpenAIProvider,
  OPENAI_PROVIDER,
  OpenAIProviderRegistration,
} from './openai-provider.js';

@Module({
  providers: [
    AIExecutionService,
    AgentToolRegistry,
    AgentExecutionService,
    OpenAIProviderRegistration,
    {
      provide: OPENAI_PROVIDER,
      useFactory: () => createOpenAIProvider(process.env),
    },
    { provide: AI_EXECUTION_TIMEOUT_MS, useValue: 30_000 },
    {
      provide: AI_APPROVAL_VERIFIER,
      useValue: { verify: async () => false },
    },
    { provide: AGENT_DEFINITION_STORE, useValue: { get: async () => null } },
    {
      provide: AGENT_HISTORY_STORE,
      useValue: {
        begin: async () => {
          throw new Error('Agent history storage is not configured');
        },
        recordStep: async () => {
          throw new Error('Agent history storage is not configured');
        },
        complete: async () => {
          throw new Error('Agent history storage is not configured');
        },
        fail: async () => {
          throw new Error('Agent history storage is not configured');
        },
      } satisfies AgentExecutionHistoryStore,
    },
    {
      provide: AGENT_MEMORY,
      useValue: { loadContext: async () => '' },
    },
    {
      provide: AGENT_APPROVAL_VERIFIER,
      useValue: {
        verify: async () => false,
      },
    },
  ],
  exports: [AIExecutionService, AgentExecutionService, AgentToolRegistry],
})
export class AIStudioModule {}
