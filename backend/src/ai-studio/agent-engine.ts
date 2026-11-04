import { Inject, Injectable, Optional } from '@nestjs/common';
import { AIExecutionService } from './ai-execution.js';
import {
  isVerifiedTenantContext,
  type VerifiedTenantContext,
} from '../identity/tenant-authorization.js';

export const AGENT_DEFINITION_STORE = Symbol('AGENT_DEFINITION_STORE');
export const AGENT_HISTORY_STORE = Symbol('AGENT_HISTORY_STORE');
export const AGENT_MEMORY = Symbol('AGENT_MEMORY');
export const AGENT_APPROVAL_VERIFIER = Symbol('AGENT_APPROVAL_VERIFIER');

export interface AgentDefinition {
  id: string;
  version: number;
  enabled: boolean;
  providerId: string;
  modelId: string;
  allowedToolIds: readonly string[];
  maxSteps: number;
  maxOutputTokens: number;
}

export interface AgentTool {
  id: string;
  effect: 'read' | 'write';
  minimumRole?: VerifiedTenantContext['role'];
  validateInput(input: unknown): unknown;
  execute(
    input: unknown,
    context: VerifiedTenantContext,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export interface AgentDefinitionStore {
  get(tenantId: string, agentId: string): Promise<AgentDefinition | null>;
}

export interface AgentMemory {
  loadContext(
    tenantId: string,
    agentId: string,
    userId: string,
    query: string,
  ): Promise<string>;
}

export interface AgentApprovalVerifier {
  verify(
    reference: string,
    context: VerifiedTenantContext,
    agentId: string,
    toolId: string,
  ): Promise<boolean>;
}

export interface AgentExecutionHistoryStore {
  begin(input: {
    tenantId: string;
    userId: string;
    agentId: string;
    agentVersion: number;
  }): Promise<string>;
  recordStep(input: {
    executionId: string;
    toolId: string;
    status: 'started' | 'completed';
    output?: unknown;
  }): Promise<void>;
  complete(input: {
    executionId: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<void>;
  fail(input: {
    executionId: string;
    code: AgentExecutionError['code'];
  }): Promise<void>;
}

export interface AgentRunRequest {
  context: VerifiedTenantContext;
  agentId: string;
  task: string;
  approvalReferences?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  executionId: string;
  status: 'completed';
  providerId: string;
  modelId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  steps: Array<{ toolId: string; output: unknown }>;
}

export class AgentExecutionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_CONTEXT'
      | 'INVALID_TASK'
      | 'AGENT_UNAVAILABLE'
      | 'INVALID_AGENT_CONFIGURATION'
      | 'HISTORY_UNAVAILABLE'
      | 'INVALID_PLAN'
      | 'TOOL_NOT_ALLOWED'
      | 'APPROVAL_REQUIRED'
      | 'TOOL_FAILED'
      | 'EXECUTION_FAILED',
  ) {
    super(message);
    this.name = 'AgentExecutionError';
  }
}

const MAX_TASK_CHARACTERS = 20_000;
const MAX_TOOL_OUTPUT_CHARACTERS = 50_000;
const ROLE_LEVEL = { member: 1, admin: 2, owner: 3 } as const;
const EMPTY_MEMORY: AgentMemory = { loadContext: async () => '' };
const DENY_APPROVALS: AgentApprovalVerifier = {
  verify: async () => false,
};
const NO_AGENT_DEFINITIONS: AgentDefinitionStore = {
  get: async () => null,
};
const NO_AGENT_HISTORY: AgentExecutionHistoryStore = {
  begin: async () => {
    throw new AgentExecutionError(
      'Durable agent execution history is not configured',
      'HISTORY_UNAVAILABLE',
    );
  },
  recordStep: async () => {
    throw new AgentExecutionError(
      'Durable agent execution history is not configured',
      'HISTORY_UNAVAILABLE',
    );
  },
  complete: async () => {
    throw new AgentExecutionError(
      'Durable agent execution history is not configured',
      'HISTORY_UNAVAILABLE',
    );
  },
  fail: async () => {
    throw new AgentExecutionError(
      'Durable agent execution history is not configured',
      'HISTORY_UNAVAILABLE',
    );
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePlan(
  output: string,
  maximumSteps: number,
): Array<{ toolId: string; input: unknown }> {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new AgentExecutionError(
      'Agent planner returned invalid structured output',
      'INVALID_PLAN',
    );
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.steps) ||
    value.steps.length > maximumSteps
  ) {
    throw new AgentExecutionError(
      'Agent plan does not match the supported schema or step limit',
      'INVALID_PLAN',
    );
  }

  return value.steps.map((step) => {
    if (
      !isRecord(step) ||
      typeof step.toolId !== 'string' ||
      !step.toolId.trim() ||
      !Object.hasOwn(step, 'input')
    ) {
      throw new AgentExecutionError(
        'Agent plan contains a malformed step',
        'INVALID_PLAN',
      );
    }
    return { toolId: step.toolId, input: step.input };
  });
}

function estimateSerializedSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

@Injectable()
export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (
      !tool.id.trim() ||
      this.tools.has(tool.id) ||
      (tool.effect !== 'read' && tool.effect !== 'write')
    ) {
      throw new Error('Agent tool registration is invalid or duplicated');
    }
    this.tools.set(tool.id, tool);
  }

  get(toolId: string): AgentTool | undefined {
    return this.tools.get(toolId);
  }
}

@Injectable()
export class AgentExecutionService {
  constructor(
    private readonly ai: AIExecutionService,
    private readonly tools: AgentToolRegistry,
    @Optional()
    @Inject(AGENT_DEFINITION_STORE)
    private readonly definitions: AgentDefinitionStore = NO_AGENT_DEFINITIONS,
    @Optional()
    @Inject(AGENT_HISTORY_STORE)
    private readonly history: AgentExecutionHistoryStore = NO_AGENT_HISTORY,
    @Optional()
    @Inject(AGENT_MEMORY)
    private readonly memory: AgentMemory = EMPTY_MEMORY,
    @Optional()
    @Inject(AGENT_APPROVAL_VERIFIER)
    private readonly approvals: AgentApprovalVerifier = DENY_APPROVALS,
  ) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    if (!isVerifiedTenantContext(request.context)) {
      throw new AgentExecutionError(
        'A verified tenant context is required',
        'INVALID_CONTEXT',
      );
    }
    if (
      !request.task.trim() ||
      request.task.length > MAX_TASK_CHARACTERS ||
      estimateSerializedSize(request.task) > MAX_TASK_CHARACTERS * 4
    ) {
      throw new AgentExecutionError('Agent task is invalid', 'INVALID_TASK');
    }

    const definition = await this.definitions.get(
      request.context.tenantId,
      request.agentId,
    );
    if (!definition?.enabled) {
      throw new AgentExecutionError(
        'Agent is unavailable for this tenant',
        'AGENT_UNAVAILABLE',
      );
    }
    if (
      !definition.id.trim() ||
      definition.id !== request.agentId ||
      !definition.providerId.trim() ||
      !definition.modelId.trim() ||
      !Array.isArray(definition.allowedToolIds) ||
      definition.allowedToolIds.some(
        (toolId) => typeof toolId !== 'string' || !toolId.trim(),
      ) ||
      !Number.isSafeInteger(definition.version) ||
      definition.version < 1 ||
      !Number.isSafeInteger(definition.maxSteps) ||
      definition.maxSteps < 0 ||
      definition.maxSteps > 8 ||
      !Number.isSafeInteger(definition.maxOutputTokens) ||
      definition.maxOutputTokens < 1 ||
      definition.maxOutputTokens > 8_192 ||
      new Set(definition.allowedToolIds).size !==
        definition.allowedToolIds.length
    ) {
      throw new AgentExecutionError(
        'Agent configuration is invalid',
        'INVALID_AGENT_CONFIGURATION',
      );
    }

    const memory = await this.memory.loadContext(
      request.context.tenantId,
      definition.id,
      request.context.userId,
      request.task,
    );
    if (memory.length > 32_000) {
      throw new AgentExecutionError(
        'Agent context exceeds its size limit',
        'INVALID_TASK',
      );
    }

    let executionId: string;
    try {
      executionId = await this.history.begin({
        tenantId: request.context.tenantId,
        userId: request.context.userId,
        agentId: definition.id,
        agentVersion: definition.version,
      });
    } catch {
      throw new AgentExecutionError(
        'Durable agent execution history is unavailable',
        'HISTORY_UNAVAILABLE',
      );
    }

    try {
      const planResult = await this.ai.execute({
        providerId: definition.providerId,
        modelId: definition.modelId,
        prompt: JSON.stringify({
          task: request.task,
          context: memory,
          allowedTools: definition.allowedToolIds,
          responseSchema: {
            version: 1,
            steps: [{ toolId: 'string', input: 'object' }],
          },
          instructions:
            'Return only a JSON plan matching responseSchema. Never invent tools or execute operations outside the provided allowlist.',
        }),
        maxOutputTokens: definition.maxOutputTokens,
        signal: request.signal,
      });
      const plan = parsePlan(planResult.output, definition.maxSteps);
      const steps: Array<{ toolId: string; output: unknown }> = [];

      for (const step of plan) {
        if (!definition.allowedToolIds.includes(step.toolId)) {
          throw new AgentExecutionError(
            'Agent plan requested a tool outside its allowlist',
            'TOOL_NOT_ALLOWED',
          );
        }
        const tool = this.tools.get(step.toolId);
        if (!tool) {
          throw new AgentExecutionError(
            'Agent plan requested an unregistered tool',
            'TOOL_NOT_ALLOWED',
          );
        }
        const minimumRole: VerifiedTenantContext['role'] =
          tool.effect === 'write'
            ? tool.minimumRole === 'owner'
              ? 'owner'
              : 'admin'
            : (tool.minimumRole ?? 'member');
        if (ROLE_LEVEL[request.context.role] < ROLE_LEVEL[minimumRole]) {
          throw new AgentExecutionError(
            'Tenant role is not permitted to execute this tool',
            'TOOL_NOT_ALLOWED',
          );
        }
        if (request.signal?.aborted) {
          throw new AgentExecutionError(
            'Agent execution was cancelled',
            'EXECUTION_FAILED',
          );
        }

        const input = tool.validateInput(step.input);
        if (estimateSerializedSize(input) > 32_000) {
          throw new AgentExecutionError(
            'Validated tool input exceeds its size limit',
            'INVALID_PLAN',
          );
        }
        if (tool.effect === 'write') {
          const approvalReference =
            request.approvalReferences?.[tool.id]?.trim();
          if (
            !approvalReference ||
            (await this.approvals.verify(
              approvalReference,
              request.context,
              definition.id,
              tool.id,
            )) !== true
          ) {
            throw new AgentExecutionError(
              'Write tool requires verified human approval',
              'APPROVAL_REQUIRED',
            );
          }
        }

        try {
          await this.history.recordStep({
            executionId,
            toolId: tool.id,
            status: 'started',
          });
        } catch {
          throw new AgentExecutionError(
            'Unable to persist agent tool execution history',
            'HISTORY_UNAVAILABLE',
          );
        }

        let output: unknown;
        try {
          output = await tool.execute(input, request.context, request.signal);
        } catch {
          throw new AgentExecutionError(
            'Agent tool execution failed',
            'TOOL_FAILED',
          );
        }
        if (estimateSerializedSize(output) > MAX_TOOL_OUTPUT_CHARACTERS) {
          throw new AgentExecutionError(
            'Agent tool output exceeds its size limit',
            'TOOL_FAILED',
          );
        }

        try {
          await this.history.recordStep({
            executionId,
            toolId: tool.id,
            status: 'completed',
            output,
          });
        } catch {
          throw new AgentExecutionError(
            'Unable to persist agent tool execution history',
            'HISTORY_UNAVAILABLE',
          );
        }
        steps.push({ toolId: tool.id, output });
      }

      try {
        await this.history.complete({
          executionId,
          inputTokens: planResult.usage.inputTokens,
          outputTokens: planResult.usage.outputTokens,
        });
      } catch {
        throw new AgentExecutionError(
          'Unable to persist agent execution completion',
          'HISTORY_UNAVAILABLE',
        );
      }

      return {
        executionId,
        status: 'completed',
        providerId: planResult.providerId,
        modelId: planResult.modelId,
        usage: planResult.usage,
        steps,
      };
    } catch (error) {
      const failureCode =
        error instanceof AgentExecutionError ? error.code : 'EXECUTION_FAILED';
      try {
        await this.history.fail({ executionId, code: failureCode });
      } catch {
        throw new AgentExecutionError(
          'Agent execution failed and its failure record could not be persisted',
          'HISTORY_UNAVAILABLE',
        );
      }
      if (error instanceof AgentExecutionError) throw error;
      throw new AgentExecutionError(
        'Agent execution failed',
        'EXECUTION_FAILED',
      );
    }
  }
}
