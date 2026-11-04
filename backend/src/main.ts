import { NestFactory } from '@nestjs/core';
import { configureApplication } from './app-bootstrap.js';
import { parseDatabaseConfiguration } from './database/database.config.js';
import { parseObserveConfiguration } from './observe-config.js';

async function bootstrap() {
  parseObserveConfiguration();
  parseDatabaseConfiguration();
  const { AppModule, ObserveInstrument } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  app.enableShutdownHooks();

  const port = configureApplication(app);

  await app.listen(port);

  console.log('ZIBEN Nova API running on port ' + port);
}

void bootstrap();
