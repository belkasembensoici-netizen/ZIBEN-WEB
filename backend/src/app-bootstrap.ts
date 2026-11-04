import {
  ValidationPipe,
  VersioningType,
  type INestApplication,
} from '@nestjs/common';

export interface AppEnvironment {
  PORT?: string;
  CORS_ORIGIN?: string;
}

export function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 3000;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const port = Number(trimmed);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return port;
}

export function parseCorsOrigins(value: string | undefined): string[] | false {
  if (value === undefined || value.trim() === '') {
    return false;
  }

  const entries = value.split(',').map((origin) => origin.trim());
  if (entries.some((origin) => origin === '')) {
    throw new Error(
      'CORS_ORIGIN must be a comma-separated list of HTTP(S) origins',
    );
  }

  const origins = entries.map((origin) => {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(
        'CORS_ORIGIN must be a comma-separated list of HTTP(S) origins',
      );
    }

    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new Error(
        'CORS_ORIGIN entries must be HTTP(S) origins without paths or credentials',
      );
    }

    return url.origin;
  });

  return [...new Set(origins)];
}

export function configureApplication(
  app: INestApplication,
  environment: AppEnvironment = process.env,
): number {
  const port = parsePort(environment.PORT);
  const corsOrigins = parseCorsOrigins(environment.CORS_ORIGIN);

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  });

  return port;
}
