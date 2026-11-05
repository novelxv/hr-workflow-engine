import { migrate } from "drizzle-orm/postgres-js/migrator";

import { db, sqlClient } from "./client.js";

await migrate(db, { migrationsFolder: "./drizzle" });
await sqlClient.end();
console.log("migrations applied");
