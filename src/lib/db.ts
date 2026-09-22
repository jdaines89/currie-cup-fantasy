import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DB_PATH = process.env.DATABASE_PATH ?? join(process.cwd(), "currie-cup.db");

let db: Database.Database | undefined;

/** The one connection. Migrations are idempotent, so opening is safe anywhere. */
export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(process.cwd(), "src/lib/schema.sql"), "utf8"));
  return db;
}

export const SEASON = process.env.SEASON ?? "2026";
