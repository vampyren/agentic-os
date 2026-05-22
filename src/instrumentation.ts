// Next.js server instrumentation: start the Agentic OS scheduler loop once
// per Node.js server process. The scheduler itself remains opt-in through
// features.scheduler.enabled in ~/.agentic-os/config.yaml.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Dynamic imports keep Node-only dependencies out of the Edge
    // instrumentation bundle.

    // M3: reconcile runs the previous process left active BEFORE the
    // scheduler can fire new ones — an interrupted run must not be mistaken
    // for a fresh one.
    const { recoverRunsOnStartup } = await import(
      "@/kernel/state/restartRecovery"
    );
    await recoverRunsOnStartup();

    const { startGlobalMissionScheduler } = await import("@/features/scheduler/runtime");
    await startGlobalMissionScheduler();
  }
}
