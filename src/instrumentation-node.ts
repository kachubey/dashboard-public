import { parseEnv } from "./server/env";

try {
  parseEnv(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// Hourly housekeeping (expired sessions, stale rate-limit windows, expired
// quarantine). Failures are logged and retried next hour.
const { runMaintenance } = await import("./server/maintenance");
const run = () =>
  runMaintenance().catch((error) => console.error("maintenance failed", error instanceof Error ? error.message : error));
setTimeout(run, 30_000).unref();
setInterval(run, 60 * 60 * 1000).unref();
