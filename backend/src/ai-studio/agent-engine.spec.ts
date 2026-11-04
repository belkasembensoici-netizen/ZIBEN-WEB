import { describe, expect, it, vi } from 'vitest';
import {
  AgentExecutionService,
  AgentToolRegistry,
  type AgentDefinition,
  type AgentExecutionHistoryStore,
} from './agent-engine.js';
import { AIExecutionService, type AIProvider } from './ai-execution.js';
import {
  TenantAuthorizationService,
  type VerifiedTenantContext,
} from '../identity/tenant-authorization.js';

const definition: AgentDefinition = {
  id: 'agent-1',
  version: 1,
  enabled: true,
  providerId: 'test',
  modelId: 'model-1',
  allowedToolIds: ['catalog.lookup'],
  maxSteps: 3,
  maxOutputTokens: 300,
};

async function verifiedContext(
  role: 'owner' | 'admin' | 'member' = 'owner',
): Promise<VerifiedTenantContext> {
  const authorization = new TenantAuthorizationService(
    {
      verifyBearerToken: async () => ({ subject: 'user-1', issuer: 'issuer' }),
    },
    {
      findMembership: async () => ({
        tenantId: 'tenant-1',
        userId: 'user-1',
        role,
        status: 'active',
      }),
    },
  );
  return authorization.authorize('valid-token', 'tenant-1');
}

function setup(options?: {
  plan?: string;
  toolIds?: string[];
  effect?: 'read' | 'write';
  minimumRole?: 'owner' | 'admin' | 'member';
  approval?: boolean;
  definition?: AgentDefinition | null;
  toolFailure?: boolean;
}) {
  const ai = new AIExecutionService();
  const provider: AIProvider = {
    id: 'test',
    modelIds: ['model-1'],
    generate: vi.fn(async () => ({
      output:
        options?.plan ??
        JSON.stringify({
          version: 1,
          steps: [
            {
              toolId: 'catalog.lookup',
              input: { sku: 'sku-1' },
            },
          ],
        }),
      usage: { inputTokens: 10, outputTokens: 5 },
    })),
  };
  ai.registerProvider(provider);

  const tools = new AgentToolRegistry();
  const executeTool = vi.fn(async () => {
    if (options?.toolFailure) throw new Error('sensitive provider detail');
    return { title: 'Product' };
  });
  const registeredIds = options?.toolIds ?? ['catalog.lookup'];
  for (const id of registeredIds) {
    tools.register({
      id,
      effect: options?.effect ?? 'read',
      minimumRole: options?.minimumRole,
      validateInput(input) {
        if (
          typeof input !== 'object' ||
          input === null ||
          typeof (input as { sku?: unknown }).sku !== 'string'
        ) {
          throw new Error('Invalid SKU input');
        }
        return input;
      },
      execute: executeTool,
    });
  }

  const historyCalls: string[] = [];
  const begin = vi.fn(async () => {
    historyCalls.push('begin');
    return 'execution-1';
  });
  const recordStep = vi.fn(async ({ status }: { status: string }) => {
    historyCalls.push(`step-${status}`);
  });
  const complete = vi.fn(async () => {
    historyCalls.push('complete');
  });
  const fail = vi.fn(async () => {
    historyCalls.push('fail');
  });
  const history: AgentExecutionHistoryStore = {
    begin,
    recordStep,
    complete,
    fail,
  };
  const service = new AgentExecutionService(
    ai,
    tools,
    {
      get: async () =>
        options?.definition === null
          ? null
          : (options?.definition ?? definition),
    },
    history,
    { loadContext: async () => 'Tenant-scoped context' },
    { verify: async () => options?.approval ?? false },
  );
  return {
    service,
    provider,
    executeTool,
    history,
    historyCalls,
    begin,
    fail,
  };
}

describe('AgentExecutionService', () => {
  it('plans and executes only registered, allowlisted tools with persisted history', async () => {
    const { service, executeTool, historyCalls } = setup();
    const context = await verifiedContext();
    const result = await service.run({
      context,
      agentId: 'agent-1',
      task: 'Look up sku-1',
    });

    expect(result).toMatchObject({
      executionId: 'execution-1',
      status: 'completed',
      usage: { inputTokens: 10, outputTokens: 5 },
      steps: [{ toolId: 'catalog.lookup', output: { title: 'Product' } }],
    });
    expect(executeTool).toHaveBeenCalledOnce();
    expect(historyCalls).toEqual([
      'begin',
      'step-started',
      'step-completed',
      'complete',
    ]);
  });

  it('rejects caller-created tenant contexts before agent lookup', async () => {
    const { service, begin } = setup();
    await expect(
      service.run({
        context: {
          userId: 'user-1',
          tenantId: 'tenant-1',
          role: 'owner',
          issuer: 'issuer',
        } as VerifiedTenantContext,
        agentId: 'agent-1',
        task: 'run',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONTEXT' });
    expect(begin).not.toHaveBeenCalled();
  });

  it('fails closed when agent definitions or durable history are unavailable', async () => {
    const context = await verifiedContext();
    const unavailableDefinition = setup({ definition: null });
    await expect(
      unavailableDefinition.service.run({
        context,
        agentId: 'missing',
        task: 'run',
      }),
    ).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' });
    expect(unavailableDefinition.begin).not.toHaveBeenCalled();

    const noHistory = new AgentExecutionService(
      new AIExecutionService(),
      new AgentToolRegistry(),
      { get: async () => definition },
    );
    await expect(
      noHistory.run({ context, agentId: 'agent-1', task: 'run' }),
    ).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
  });

  it('rejects malformed or out-of-allowlist plans without running tools', async () => {
    const context = await verifiedContext();
    const malformed = setup({
      plan: '{"version":2,"steps":[]}',
    });
    await expect(
      malformed.service.run({ context, agentId: 'agent-1', task: 'run' }),
    ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    expect(malformed.executeTool).not.toHaveBeenCalled();
    expect(malformed.historyCalls).toEqual(['begin', 'fail']);

    const outOfPolicy = setup({
      plan: JSON.stringify({
        version: 1,
        steps: [{ toolId: 'admin.delete', input: {} }],
      }),
    });
    await expect(
      outOfPolicy.service.run({ context, agentId: 'agent-1', task: 'run' }),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_ALLOWED' });
    expect(outOfPolicy.executeTool).not.toHaveBeenCalled();
  });

  it('requires verified approval before executing write tools', async () => {
    const context = await verifiedContext();
    const writeAgent = {
      ...definition,
      allowedToolIds: ['catalog.update'],
    };
    const plan = JSON.stringify({
      version: 1,
      steps: [{ toolId: 'catalog.update', input: { sku: 'sku-1' } }],
    });
    const unapproved = setup({
      definition: writeAgent,
      toolIds: ['catalog.update'],
      effect: 'write',
      plan,
    });
    await expect(
      unapproved.service.run({
        context,
        agentId: 'agent-1',
        task: 'update',
        approvalReferences: { 'catalog.update': 'approval-1' },
      }),
    ).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
    expect(unapproved.executeTool).not.toHaveBeenCalled();

    const approved = setup({
      definition: writeAgent,
      toolIds: ['catalog.update'],
      effect: 'write',
      approval: true,
      plan,
    });
    await approved.service.run({
      context,
      agentId: 'agent-1',
      task: 'update',
      approvalReferences: { 'catalog.update': 'approval-1' },
    });
    expect(approved.executeTool).toHaveBeenCalledOnce();
  });

  it('enforces tenant role requirements for registered tools', async () => {
    const memberContext = await verifiedContext('member');
    const writeAgent = {
      ...definition,
      allowedToolIds: ['catalog.update'],
    };
    const setupForMember = setup({
      definition: writeAgent,
      toolIds: ['catalog.update'],
      effect: 'write',
      approval: true,
      plan: JSON.stringify({
        version: 1,
        steps: [{ toolId: 'catalog.update', input: { sku: 'sku-1' } }],
      }),
    });

    await expect(
      setupForMember.service.run({
        context: memberContext,
        agentId: 'agent-1',
        task: 'update',
        approvalReferences: { 'catalog.update': 'approval-1' },
      }),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_ALLOWED' });
    expect(setupForMember.executeTool).not.toHaveBeenCalled();

    const memberWriteTool = setup({
      definition: writeAgent,
      toolIds: ['catalog.update'],
      effect: 'write',
      minimumRole: 'member',
      approval: true,
      plan: JSON.stringify({
        version: 1,
        steps: [{ toolId: 'catalog.update', input: { sku: 'sku-1' } }],
      }),
    });
    await expect(
      memberWriteTool.service.run({
        context: memberContext,
        agentId: 'agent-1',
        task: 'update',
        approvalReferences: { 'catalog.update': 'approval-1' },
      }),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_ALLOWED' });
    expect(memberWriteTool.executeTool).not.toHaveBeenCalled();
  });

  it('persists tool failures and returns a sanitized error', async () => {
    const context = await verifiedContext();
    const { service, fail, historyCalls } = setup({ toolFailure: true });
    await expect(
      service.run({ context, agentId: 'agent-1', task: 'run' }),
    ).rejects.toMatchObject({ code: 'TOOL_FAILED' });
    expect(fail).toHaveBeenCalledWith({
      executionId: 'execution-1',
      code: 'TOOL_FAILED',
    });
    expect(historyCalls).toEqual(['begin', 'step-started', 'fail']);
  });
});
