import { describe, expect, it, vi } from 'vitest';
import {
  AIExecutionService,
  type AIApprovalVerifier,
  type AIProvider,
} from './ai-execution.js';

function provider(
  generate: AIProvider['generate'] = async () => ({
    output: 'Structured result',
    usage: { inputTokens: 12, outputTokens: 5 },
  }),
): AIProvider {
  return {
    id: 'test-provider',
    modelIds: ['model-v1'],
    generate,
  };
}

const request = {
  providerId: 'test-provider',
  modelId: 'model-v1',
  prompt: 'Summarize this business context.',
  maxOutputTokens: 200,
};

describe('AIExecutionService', () => {
  it('executes an enabled model and returns usage metadata', async () => {
    const service = new AIExecutionService();
    service.registerProvider(provider());

    await expect(service.execute(request)).resolves.toMatchObject({
      output: 'Structured result',
      usage: { inputTokens: 12, outputTokens: 5 },
      providerId: 'test-provider',
      modelId: 'model-v1',
    });
  });

  it('rejects unknown providers and models', async () => {
    const service = new AIExecutionService();
    service.registerProvider(provider());

    await expect(
      service.execute({ ...request, providerId: 'missing' }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    await expect(
      service.execute({ ...request, modelId: 'not-enabled' }),
    ).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
    });
  });

  it('requires an attributable human approval for sensitive work', async () => {
    const service = new AIExecutionService();
    service.registerProvider(provider());

    await expect(
      service.execute({
        ...request,
        requiresHumanApproval: true,
        approvalReference: 'approval-123',
      }),
    ).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });

    const verify = vi.fn(
      async (reference: string) => reference === 'approval-123',
    );
    const approvalVerifier: AIApprovalVerifier = { verify };
    const approvedService = new AIExecutionService(30_000, approvalVerifier);
    approvedService.registerProvider(provider());
    await expect(
      approvedService.execute({
        ...request,
        requiresHumanApproval: true,
        approvalReference: 'approval-123',
      }),
    ).resolves.toMatchObject({ providerId: 'test-provider' });
    expect(verify).toHaveBeenCalledWith('approval-123');
  });

  it('rejects invalid limits and provider responses', async () => {
    const service = new AIExecutionService();
    service.registerProvider(
      provider(async () => ({
        output: '',
        usage: { inputTokens: -1, outputTokens: Number.NaN },
      })),
    );

    await expect(
      service.execute({ ...request, maxOutputTokens: 0 }),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(service.execute(request)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
    });
  });

  it('bounds provider execution and passes an abort signal', async () => {
    const generate = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const service = new AIExecutionService(10);
    service.registerProvider(provider(generate as AIProvider['generate']));

    await expect(service.execute(request)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('cancels a provider request when the caller aborts', async () => {
    const generate = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const service = new AIExecutionService(30_000);
    service.registerProvider(provider(generate as AIProvider['generate']));
    const controller = new AbortController();
    const execution = service.execute({
      ...request,
      signal: controller.signal,
    });
    controller.abort();

    await expect(execution).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(generate).toHaveBeenCalledOnce();
  });

  it('rejects duplicate or invalid provider registration', () => {
    const service = new AIExecutionService();
    service.registerProvider(provider());
    expect(() => service.registerProvider(provider())).toThrow(
      /invalid or duplicated/,
    );
  });
});
