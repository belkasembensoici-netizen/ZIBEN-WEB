import { describe, expect, it, vi } from 'vitest';
import { AIExecutionService } from './ai-execution.js';
import {
  createOpenAIProvider,
  OpenAIChatCompletionsProvider,
  OpenAIProviderRegistration,
  parseOpenAIConfiguration,
} from './openai-provider.js';

const request = {
  modelId: 'approved-model',
  prompt: 'Summarize this context.',
  maxOutputTokens: 200,
  signal: new AbortController().signal,
};

function completionResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: 'A grounded summary.' } }],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
      ...overrides,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('parseOpenAIConfiguration', () => {
  it('leaves the provider disabled when configuration is absent', () => {
    expect(parseOpenAIConfiguration({})).toBeNull();
    expect(createOpenAIProvider({})).toBeNull();
  });

  it('requires both a server-side key and an explicit model allowlist', () => {
    expect(() =>
      parseOpenAIConfiguration({ OPENAI_API_KEY: 'secret' }),
    ).toThrow('must be configured together');
    expect(() =>
      parseOpenAIConfiguration({ OPENAI_MODEL_IDS: 'model-a' }),
    ).toThrow('must be configured together');
  });

  it('normalizes and freezes the configured model allowlist', () => {
    expect(
      parseOpenAIConfiguration({
        OPENAI_API_KEY: ' secret ',
        OPENAI_MODEL_IDS: 'model-a, model-b',
      }),
    ).toEqual({ apiKey: 'secret', modelIds: ['model-a', 'model-b'] });
  });

  it.each([
    ['duplicates', 'model-a,model-a'],
    ['empty entries', 'model-a,'],
    ['whitespace', 'model a'],
    ['invalid characters', 'model-a,model/b'],
  ])('rejects %s in model IDs', (_description, modelIds) => {
    expect(() =>
      parseOpenAIConfiguration({
        OPENAI_API_KEY: 'secret',
        OPENAI_MODEL_IDS: modelIds,
      }),
    ).toThrow('unique model identifiers');
  });

  it('rejects control characters in credentials', () => {
    expect(() =>
      parseOpenAIConfiguration({
        OPENAI_API_KEY: 'secret\ninjected',
        OPENAI_MODEL_IDS: 'model-a',
      }),
    ).toThrow('invalid format');
  });
});

describe('OpenAIChatCompletionsProvider', () => {
  it('registers and executes through the Core AI execution service', async () => {
    const provider = createOpenAIProvider(
      {
        OPENAI_API_KEY: 'server-secret',
        OPENAI_MODEL_IDS: 'approved-model',
      },
      vi.fn(async () => completionResponse()) as unknown as typeof fetch,
    );
    expect(provider).not.toBeNull();

    const executions = new AIExecutionService();
    new OpenAIProviderRegistration(executions, provider).onModuleInit();

    await expect(
      executions.execute({
        providerId: 'openai',
        modelId: 'approved-model',
        prompt: request.prompt,
        maxOutputTokens: request.maxOutputTokens,
      }),
    ).resolves.toMatchObject({
      output: 'A grounded summary.',
      usage: { inputTokens: 12, outputTokens: 5 },
      providerId: 'openai',
      modelId: 'approved-model',
    });
  });

  it('sends bounded model requests to the fixed HTTPS endpoint and parses usage', async () => {
    const fetcher = vi.fn(async () => completionResponse());
    const provider = new OpenAIChatCompletionsProvider(
      'server-secret',
      ['approved-model'],
      fetcher as unknown as typeof fetch,
    );

    await expect(provider.generate(request)).resolves.toEqual({
      output: 'A grounded summary.',
      usage: { inputTokens: 12, outputTokens: 5 },
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        signal: request.signal,
        headers: expect.objectContaining({
          Authorization: 'Bearer server-secret',
        }),
        body: JSON.stringify({
          model: 'approved-model',
          messages: [{ role: 'user', content: request.prompt }],
          max_completion_tokens: request.maxOutputTokens,
          stream: false,
        }),
      }),
    );
  });

  it('surfaces provider status without forwarding provider error bodies', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('sensitive provider diagnostics', {
          status: 429,
          statusText: 'Too Many Requests',
        }),
    );
    const provider = new OpenAIChatCompletionsProvider(
      'server-secret',
      ['approved-model'],
      fetcher as unknown as typeof fetch,
    );

    await expect(provider.generate(request)).rejects.toThrow(
      'OpenAI request failed with status 429',
    );
  });

  it('rejects malformed, invalid, and oversized provider responses', async () => {
    const invalidProvider = new OpenAIChatCompletionsProvider(
      'server-secret',
      ['approved-model'],
      vi.fn(async () =>
        completionResponse({
          usage: { prompt_tokens: -1, completion_tokens: 2 },
        }),
      ) as unknown as typeof fetch,
    );
    await expect(invalidProvider.generate(request)).rejects.toThrow(
      'invalid completion response',
    );

    const malformedProvider = new OpenAIChatCompletionsProvider(
      'server-secret',
      ['approved-model'],
      vi.fn(async () => new Response('{')) as unknown as typeof fetch,
    );
    await expect(malformedProvider.generate(request)).rejects.toThrow(
      'invalid JSON',
    );

    const oversizedProvider = new OpenAIChatCompletionsProvider(
      'server-secret',
      ['approved-model'],
      vi.fn(
        async () => new Response('x'.repeat(1_048_577), { status: 200 }),
      ) as unknown as typeof fetch,
    );
    await expect(oversizedProvider.generate(request)).rejects.toThrow(
      'exceeds the configured size limit',
    );

    const nullProvider = new OpenAIChatCompletionsProvider(
      'server-secret',
      ['approved-model'],
      vi.fn(async () => new Response('null')) as unknown as typeof fetch,
    );
    await expect(nullProvider.generate(request)).rejects.toThrow(
      'invalid completion response',
    );
  });

  it('does not send requests for models outside its allowlist', async () => {
    const fetcher = vi.fn(async () => completionResponse());
    const provider = new OpenAIChatCompletionsProvider(
      'server-secret',
      ['approved-model'],
      fetcher as unknown as typeof fetch,
    );

    await expect(
      provider.generate({ ...request, modelId: 'unapproved-model' }),
    ).rejects.toThrow('not enabled for this provider');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('propagates cancellation to the provider transport', async () => {
    const fetcher = vi.fn(
      (_url: string | URL | Request, options?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const provider = new OpenAIChatCompletionsProvider(
      'server-secret',
      ['approved-model'],
      fetcher as unknown as typeof fetch,
    );
    const execution = provider.generate({
      ...request,
      signal: controller.signal,
    });
    controller.abort();

    await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
  });
});
