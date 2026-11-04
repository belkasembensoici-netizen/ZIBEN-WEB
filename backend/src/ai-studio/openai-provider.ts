import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { AIExecutionService } from './ai-execution.js';
import type {
  AIModelRequest,
  AIProvider,
  AIProviderResult,
} from './ai-execution.js';

export const OPENAI_PROVIDER = Symbol('OPENAI_PROVIDER');

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_MODELS = 32;
const MAX_MODEL_ID_LENGTH = 128;
const MAX_API_KEY_LENGTH = 4_096;

export interface OpenAIEnvironment {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL_IDS?: string;
}

export interface OpenAIConfiguration {
  readonly apiKey: string;
  readonly modelIds: readonly string[];
}

export function parseOpenAIConfiguration(
  environment: OpenAIEnvironment,
): OpenAIConfiguration | null {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  const modelList = environment.OPENAI_MODEL_IDS?.trim();

  if (!apiKey && !modelList) return null;
  if (!apiKey || !modelList) {
    throw new Error(
      'OPENAI_API_KEY and OPENAI_MODEL_IDS must be configured together',
    );
  }
  if (
    apiKey.length > MAX_API_KEY_LENGTH ||
    Array.from(apiKey).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    throw new Error('OPENAI_API_KEY has an invalid format');
  }

  const modelIds = modelList.split(',').map((modelId) => modelId.trim());
  if (
    modelIds.length === 0 ||
    modelIds.length > MAX_MODELS ||
    modelIds.some(
      (modelId) =>
        !modelId ||
        modelId.length > MAX_MODEL_ID_LENGTH ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(modelId),
    ) ||
    new Set(modelIds).size !== modelIds.length
  ) {
    throw new Error(
      'OPENAI_MODEL_IDS must be a comma-separated list of unique model identifiers',
    );
  }

  return Object.freeze({
    apiKey,
    modelIds: Object.freeze(modelIds),
  });
}

export class OpenAIChatCompletionsProvider implements AIProvider {
  readonly id = 'openai';
  readonly modelIds: readonly string[];

  constructor(
    private readonly apiKey: string,
    modelIds: readonly string[],
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {
    this.modelIds = Object.freeze([...modelIds]);
  }

  async generate(request: AIModelRequest): Promise<AIProviderResult> {
    if (!this.modelIds.includes(request.modelId)) {
      throw new Error('Requested model is not enabled for this provider');
    }

    const response = await this.fetcher(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.modelId,
        messages: [{ role: 'user', content: request.prompt }],
        max_completion_tokens: request.maxOutputTokens,
        stream: false,
      }),
      cache: 'no-store',
      redirect: 'error',
      signal: request.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }

    const text = await readBoundedBody(response, MAX_RESPONSE_BYTES);
    let result: unknown;
    try {
      result = JSON.parse(text) as unknown;
    } catch {
      throw new Error('OpenAI returned invalid JSON');
    }

    if (!isRecord(result) || !Array.isArray(result.choices)) {
      throw new Error('OpenAI returned an invalid completion response');
    }
    const firstChoice = result.choices[0];
    if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
      throw new Error('OpenAI returned an invalid completion response');
    }
    const completion = firstChoice.message.content;
    const usage = result.usage;
    const inputTokens = isRecord(usage) ? usage.prompt_tokens : undefined;
    const outputTokens = isRecord(usage) ? usage.completion_tokens : undefined;
    if (
      typeof completion !== 'string' ||
      completion.length === 0 ||
      typeof inputTokens !== 'number' ||
      !Number.isSafeInteger(inputTokens) ||
      inputTokens < 0 ||
      typeof outputTokens !== 'number' ||
      !Number.isSafeInteger(outputTokens) ||
      outputTokens < 0
    ) {
      throw new Error('OpenAI returned an invalid completion response');
    }

    return {
      output: completion,
      usage: {
        inputTokens,
        outputTokens,
      },
    };
  }
}

export function createOpenAIProvider(
  environment: OpenAIEnvironment,
  fetcher?: typeof fetch,
): OpenAIChatCompletionsProvider | null {
  const configuration = parseOpenAIConfiguration(environment);
  if (!configuration) return null;
  return new OpenAIChatCompletionsProvider(
    configuration.apiKey,
    configuration.modelIds,
    fetcher,
  );
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error('OpenAI response exceeds the configured size limit');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error('OpenAI response exceeds the configured size limit');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class OpenAIProviderRegistration implements OnModuleInit {
  constructor(
    private readonly executions: AIExecutionService,
    @Inject(OPENAI_PROVIDER)
    private readonly provider: AIProvider | null,
  ) {}

  onModuleInit(): void {
    if (this.provider) this.executions.registerProvider(this.provider);
  }
}
