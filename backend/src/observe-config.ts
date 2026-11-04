export interface ObserveEnvironment {
  OBSERVE_ENABLED?: string;
  OBSERVE_APP_KEY?: string;
  OBSERVE_APP_SECRET?: string;
  OBSERVE_ENDPOINT?: string;
}

export interface ObserveConfiguration {
  enabled: boolean;
  appKey?: string;
  appSecret?: string;
  endpoint?: string;
}

export const APPROVED_OBSERVE_ENDPOINTS: readonly string[] = [];

const PLACEHOLDER_CREDENTIALS = new Set(['your_app_key', 'your_app_secret']);

const INVALID_ENDPOINT_MESSAGE =
  'OBSERVE_ENDPOINT must be an approved HTTPS origin without a path, credentials, query, fragment, or non-standard port';

function isPlaceholderCredential(value: string): boolean {
  return PLACEHOLDER_CREDENTIALS.has(value.toLowerCase());
}

function validateEndpoint(
  value: string,
  approvedEndpoints: readonly string[],
): string {
  if (value !== value.trim() || value === '') {
    throw new Error(INVALID_ENDPOINT_MESSAGE);
  }

  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error(INVALID_ENDPOINT_MESSAGE);
  }

  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.pathname !== '/' ||
    endpoint.search !== '' ||
    endpoint.hash !== '' ||
    endpoint.port !== '' ||
    value.includes('?') ||
    value.includes('#')
  ) {
    throw new Error(INVALID_ENDPOINT_MESSAGE);
  }

  if (!approvedEndpoints.includes(endpoint.origin)) {
    throw new Error('OBSERVE_ENDPOINT is not in the approved destination list');
  }

  return endpoint.origin;
}

export function parseObserveConfiguration(
  environment: ObserveEnvironment = process.env,
  approvedEndpoints: readonly string[] = APPROVED_OBSERVE_ENDPOINTS,
): ObserveConfiguration {
  const enabledValue = environment.OBSERVE_ENABLED;
  if (
    enabledValue !== undefined &&
    enabledValue !== 'true' &&
    enabledValue !== 'false'
  ) {
    throw new Error('OBSERVE_ENABLED must be either "true" or "false"');
  }

  const enabled = enabledValue === 'true';
  const keyValue = environment.OBSERVE_APP_KEY;
  const secretValue = environment.OBSERVE_APP_SECRET;

  if (!enabled) {
    if (environment.OBSERVE_ENDPOINT !== undefined) {
      validateEndpoint(environment.OBSERVE_ENDPOINT, approvedEndpoints);
    }

    return { enabled: false };
  }

  if (keyValue === undefined && secretValue === undefined) {
    throw new Error(
      'OBSERVE_APP_KEY and OBSERVE_APP_SECRET are required when OBSERVE_ENABLED=true',
    );
  }

  if (keyValue === undefined || secretValue === undefined) {
    throw new Error(
      'OBSERVE_APP_KEY and OBSERVE_APP_SECRET must be configured together',
    );
  }

  const appKey = keyValue.trim();
  const appSecret = secretValue.trim();
  if (
    appKey === '' ||
    appSecret === '' ||
    isPlaceholderCredential(appKey) ||
    isPlaceholderCredential(appSecret)
  ) {
    throw new Error(
      'Observe credentials must be non-empty and must not be scaffold placeholders',
    );
  }

  const endpointValue = environment.OBSERVE_ENDPOINT;
  if (endpointValue === undefined) {
    throw new Error(
      'OBSERVE_ENDPOINT must be explicitly configured when OBSERVE_ENABLED=true',
    );
  }

  return {
    enabled: true,
    appKey,
    appSecret,
    endpoint: validateEndpoint(endpointValue, approvedEndpoints),
  };
}

export async function loadObserveModule<T>(
  loadModule: () => Promise<T>,
  environment: ObserveEnvironment = process.env,
  approvedEndpoints: readonly string[] = APPROVED_OBSERVE_ENDPOINTS,
): Promise<{ configuration: ObserveConfiguration; observeModule: T }> {
  const configuration = parseObserveConfiguration(
    environment,
    approvedEndpoints,
  );
  const observeModule = await loadModule();

  return { configuration, observeModule };
}
