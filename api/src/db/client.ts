import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../env.js";
import * as schema from "./schema.js";

// Neon's pooler runs PgBouncer in transaction mode, so prepared statements are off.
export const sqlClient = postgres(env.DATABASE_URL, { max: 5, prepare: false, idle_timeout: 20 });
export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
