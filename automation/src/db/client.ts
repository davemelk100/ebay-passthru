import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../lib/env.js";
import * as schema from "./schema.js";

// Single shared pool across the process — Cloud Run reuses instances under
// Fluid Compute, so one pool per cold start is correct. Tuned conservatively
// for v0; bump max connections once we have real traffic shape.
const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(sql, { schema });
export type Db = typeof db;
