import { Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { parseDatabaseConfiguration } from './database.config.js';
import { DatabasePoolLifecycle } from './database-pool.lifecycle.js';
import { DatabaseService } from './database.service.js';
import { schema } from './schema/index.js';
import {
  DATABASE_CONFIGURATION,
  DATABASE_POOL,
  DRIZZLE_DATABASE,
} from './database.tokens.js';
import type { DatabaseConfiguration } from './database.config.js';

@Module({
  providers: [
    {
      provide: DATABASE_CONFIGURATION,
      useFactory: parseDatabaseConfiguration,
    },
    {
      provide: DATABASE_POOL,
      inject: [DATABASE_CONFIGURATION],
      useFactory: (configuration: DatabaseConfiguration) =>
        new Pool({
          connectionString: configuration.connectionString,
          max: configuration.max,
          idleTimeoutMillis: configuration.idleTimeoutMillis,
          connectionTimeoutMillis: configuration.connectionTimeoutMillis,
          ssl: configuration.ssl,
          application_name: 'ziben-nova-backend',
        }),
    },
    {
      provide: DRIZZLE_DATABASE,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
    },
    DatabasePoolLifecycle,
    DatabaseService,
  ],
  exports: [DRIZZLE_DATABASE, DatabaseService],
})
export class DatabaseModule {}
