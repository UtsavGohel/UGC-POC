import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

// Reuse one pool across Next.js hot reloads in development.
const globalForDb = globalThis as unknown as { __db?: Db; __pool?: Pool };

function pool(): Pool {
  globalForDb.__pool ??= new Pool({ connectionString: env().DATABASE_URL, max: 10 });
  return globalForDb.__pool;
}

export function db(): Db {
  globalForDb.__db ??= drizzle(pool(), { schema });
  return globalForDb.__db;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__pool?.end();
  globalForDb.__pool = undefined;
  globalForDb.__db = undefined;
}

export { schema };
