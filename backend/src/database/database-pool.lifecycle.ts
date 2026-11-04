import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { Pool } from 'pg';
import { DATABASE_POOL } from './database.tokens.js';

@Injectable()
export class DatabasePoolLifecycle implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabasePoolLifecycle.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  onModuleInit(): void {
    this.pool.on('error', () => {
      this.logger.error('An idle PostgreSQL client encountered an error');
    });
  }

  onApplicationShutdown(): Promise<void> {
    return this.pool.end();
  }
}
