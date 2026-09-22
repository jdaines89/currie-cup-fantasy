import { rmSync } from "node:fs";
import { join } from "node:path";

const path = process.env.DATABASE_PATH ?? join(process.cwd(), "currie-cup.db");
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  rmSync(path + suffix, { force: true });
}
console.log(`Dropped ${path}`);
