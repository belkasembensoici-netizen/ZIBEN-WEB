import { Inject, Injectable, Optional } from '@nestjs/common';

export const AI_EXECUTION_TIMEOUT_MS = Symbol('AI_EXECUTION_TIMEOUT_MS');
export const AI_APPROVAL_VERIFIER = Symbol('AI_APPROVAL_VERIFIER');

export interface AIApprovalVerifier {
  verify(approvalReference: string): Promise<boolean>;
}

export interface AIModelRequest {
  modelId: string;
  prompt: string;
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface AIProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AIProviderResult {
  output: string;
  usage: AIProviderUsage;
}

export interface AIProvider {
  readonly id: string;
  readonly modelIds: readonly string[];
  generate(request: AIModelRequest): Promise<AIProviderResult>;
}

export interface AIExecutionRequest {
  providerId: string;
  modelId: string;
  prompt: string;
  maxOutputTokens: number;
  requiresHumanApproval?: boolean;
  approvalReference?: string;
  signal?: AbortSignal;
}

export interface AIExecutionResult extends AIProviderResult {
  providerId: string;
  modelId: string;
  durationMs: number;
}

export class AIExecutionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'PROVIDER_UNAVAILABLE'
      | 'MODEL_UNAVAILABLE'
      | 'INVALID_REQUEST'
      | 'APPROVAL_REQUIRED'
      | 'PROVIDER_TIMEOUT'
      | 'CANCELLED'
      | 'PROVIDER_FAILURE'
      | 'INVALID_PROVIDER_RESPONSE',
  ) {
    super(message);
    this.name = 'AIExecutionError';
  }
}

const MAX_PROMPT_CHARACTERS = 32_000;
const MAX_OUTPUT_TOKENS = 8_192;
const DEFAULT_TIMEOUT_MS = 30_000;

function validateUsage(usage: AIProviderUsage): boolean {
  return (
    Number.isSafeInteger(usage.inputTokens) &&
    usage.inputTokens >= 0 &&
    Number.isSafeInteger(usage.outputTokens) &&
    usage.outputTokens >= 0
  );
}

@Injectable()
export class AIExecutionService {
  private readonly timeoutMs: number;
  private readonly providers = new Map<string, AIProvider>();

  constructor(
    @Optional()
    @Inject(AI_EXECUTION_TIMEOUT_MS)
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    @Optional()
    @Inject(AI_APPROVAL_VERIFIER)
    private readonly approvalVerifier: AIApprovalVerifier = {
      verify: async () => false,
    },
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error('AI provider timeout must be a positive integer');
    }
    this.timeoutMs = timeoutMs;
  }

  registerProvider(provider: AIProvider): void {
    if (
      !provider.id.trim() ||
      this.providers.has(provider.id) ||
      provider.modelIds.length === 0 ||
      provider.modelIds.some((modelId) => !modelId.trim())
    ) {
      throw new Error('AI provider registration is invalid or duplicated');
    }
    this.providers.set(provider.id, provider);
  }

  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    if (
      !request.prompt.trim() ||
      request.prompt.length > MAX_PROMPT_CHARACTERS ||
      !Number.isSafeInteger(request.maxOutputTokens) ||
      request.maxOutputTokens < 1 ||
      request.maxOutputTokens > MAX_OUTPUT_TOKENS
    ) {
      throw new AIExecutionError('AI request is invalid', 'INVALID_REQUEST');
    }
    if (
      request.requiresHumanApproval &&
      (!request.approvalReference?.trim() ||
        (await this.approvalVerifier.verify(request.approvalReference)) !==
          true)
    ) {
      throw new AIExecutionError(
        'This operation requires recorded human approval',
        'APPROVAL_REQUIRED',
      );
    }

    const provider = this.providers.get(request.providerId);
    if (!provider) {
      throw new AIExecutionError(
        'Requested AI provider is not configured',
        'PROVIDER_UNAVAILABLE',
      );
    }
    if (!provider.modelIds.includes(request.modelId)) {
      throw new AIExecutionError(
        'Requested model is not enabled for this provider',
        'MODEL_UNAVAILABLE',
      );
    }

    const controller = new AbortController();
    if (request.signal?.aborted) {
      throw new AIExecutionError('AI execution was cancelled', 'CANCELLED');
    }
    const startedAt = Date.now();
    let timedOut = false;
    const timeoutError = new AIExecutionError(
      'AI provider request timed out',
      'PROVIDER_TIMEOUT',
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(timeoutError);
      }, this.timeoutMs);
    });
    let cancelExecution: (() => void) | undefined;
    const cancellationPromise = new Promise<never>((_, reject) => {
      cancelExecution = () => {
        controller.abort(request.signal?.reason);
        reject(new AIExecutionError('AI execution was cancelled', 'CANCELLED'));
      };
      request.signal?.addEventListener('abort', cancelExecution, {
        once: true,
      });
    });

    try {
      const providerPromise = provider.generate({
        modelId: request.modelId,
        prompt: request.prompt,
        maxOutputTokens: request.maxOutputTokens,
        signal: controller.signal,
      });
      const result = await Promise.race([
        providerPromise,
        timeoutPromise,
        cancellationPromise,
      ]);
      if (
        typeof result.output !== 'string' ||
        result.output.length === 0 ||
        !result.usage ||
        !validateUsage(result.usage)
      ) {
        throw new AIExecutionError(
          'AI provider returned an invalid response',
          'INVALID_PROVIDER_RESPONSE',
        );
      }

      return {
        ...result,
        providerId: provider.id,
        modelId: request.modelId,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (request.signal?.aborted) {
        throw new AIExecutionError('AI execution was cancelled', 'CANCELLED');
      }
      if (timedOut) {
        throw timeoutError;
      }
      if (error instanceof AIExecutionError) {
        throw error;
      }
      throw new AIExecutionError(
        'AI provider request failed',
        'PROVIDER_FAILURE',
      );
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (cancelExecution) {
        request.signal?.removeEventListener('abort', cancelExecution);
      }
    }
  }
}
