import { serve } from "@hono/node-server";

import { app } from "./app.js";
import { env } from "./env.js";

serve({ fetch: app.fetch, port: env.PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`hr-workflow-engine API listening on :${info.port}`);
});
