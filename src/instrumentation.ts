// Runs once when the server starts. Invalid configuration (including AUTH_MOCK
// in production) stops the process instead of serving a half-configured app.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
