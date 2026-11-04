import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export type Database = NodePgDatabase;
export type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
