import { describe, expect, it, vi } from "vitest";

vi.mock("../src/features/scheduler/runtime", () => ({
  getGlobalMissionSchedulerSnapshot: () => ({
    status: "running",
    scheduled: [{ missionId: "daily-summary", cron: "0 20 * * *", timezone: "UTC" }],
    diagnostics: [],
  }),
}));

import { GET } from "../src/app/api/scheduler/status/route";

describe("GET /api/scheduler/status", () => {
  it("returns a neutral scheduler snapshot", async () => {
    const res = await GET(new Request("http://127.0.0.1:3000/api/scheduler/status"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      scheduler: {
        status: "running",
        scheduled: [{ missionId: "daily-summary", cron: "0 20 * * *", timezone: "UTC" }],
        diagnostics: [],
      },
    });
  });

  it("rejects cross-origin requests", async () => {
    const res = await GET(
      new Request("http://127.0.0.1:3000/api/scheduler/status", {
        headers: { origin: "http://evil.example" },
      }),
    );
    expect(res.status).toBe(403);
  });
});
