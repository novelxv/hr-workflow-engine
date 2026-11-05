import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

// Load api/.env for local development; real environment variables win.
try {
  const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
  }
} catch {
  // no .env file
}

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16).default("dev-only-secret-change-me-please"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  PORT: z.coerce.number().default(8002),
  DEMO_MODE: z.enum(["0", "1"]).default("1"),
  DEMO_PASSWORD: z.string().default("arunika-demo"),
  INTERNAL_TOKEN: z.string().default(""),
  HOOK_SECRET: z.string().default(""),
  PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
});

export const env = Env.parse(process.env);
