// Next.js server instrumentation: start the Agentic OS scheduler loop once
// per Node.js server process. The scheduler itself remains opt-in through
// features.scheduler.enabled in ~/.agentic-os/config.yaml.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Dynamic import keeps Node-only scheduler dependencies out of the
    // Edge instrumentation bundle.
    const { startGlobalMissionScheduler } = await import("@/features/scheduler/runtime");
    await startGlobalMissionScheduler();
  }
}
