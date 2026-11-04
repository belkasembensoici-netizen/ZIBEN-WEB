import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../database/database.tokens.js';
import type { Database } from '../database/database.types.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly database: Database) {}

  getLiveness(): { status: 'alive' } {
    return { status: 'alive' };
  }

  async getReadiness(): Promise<{
    status: 'ready';
    checks: { database: 'available' };
  }> {
    try {
      await this.database.execute(sql`select 1`);
      return { status: 'ready', checks: { database: 'available' } };
    } catch (error) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string' &&
        /^[A-Z0-9]+$/.test(error.code)
          ? error.code
          : 'unknown';
      this.logger.warn(`Database readiness check failed (code ${code})`);
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks: { database: 'unavailable' },
      });
    }
  }
}
