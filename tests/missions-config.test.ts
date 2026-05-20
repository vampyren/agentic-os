import { describe, expect, it } from "vitest";
import {
  cronExpressionSchema,
  missionConfigSchema,
  schedulerFeatureSchema,
} from "../src/kernel/schemas/scheduler";

describe("cronExpressionSchema", () => {
  it("accepts valid 5-field cron expressions", () => {
    expect(cronExpressionSchema.safeParse("0 20 * * *").success).toBe(true);
    expect(cronExpressionSchema.safeParse("*/15 9-17 * * 1-5").success).toBe(true);
    expect(cronExpressionSchema.safeParse("0 18 * * 0").success).toBe(true);
  });

  it("rejects a 6-field (sub-minute) cron expression", () => {
    expect(cronExpressionSchema.safeParse("* * * * * *").success).toBe(false);
  });

  it("rejects a cron with too few fields", () => {
    expect(cronExpressionSchema.safeParse("0 20 * *").success).toBe(false);
  });

  it("rejects structural garbage in a field", () => {
    expect(cronExpressionSchema.safeParse("0 20 ! * *").success).toBe(false);
    expect(cronExpressionSchema.safeParse("every day").success).toBe(false);
  });
});

describe("missionConfigSchema", () => {
  it("accepts a fully-specified mission entry", () => {
    const r = missionConfigSchema.safeParse({
      enabled: true,
      cron: "0 8 * * *",
      outputFolder: "00_Inbox/agentic-os/summaries",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an empty mission entry (all fields optional)", () => {
    expect(missionConfigSchema.safeParse({}).success).toBe(true);
  });

  it("honours an explicit enabled override", () => {
    const r = missionConfigSchema.parse({ enabled: false });
    expect(r.enabled).toBe(false);
  });

  it("rejects an invalid cron", () => {
    expect(missionConfigSchema.safeParse({ cron: "not a cron" }).success).toBe(false);
  });

  it("rejects a sub-minute cron", () => {
    expect(missionConfigSchema.safeParse({ cron: "* * * * * *" }).success).toBe(false);
  });

  it("rejects an outputFolder outside the allowlist", () => {
    expect(
      missionConfigSchema.safeParse({ outputFolder: "00_Inbox/agentic-os/chats" }).success,
    ).toBe(false);
  });

  it("rejects an unknown key (strict)", () => {
    expect(missionConfigSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });
});

describe("schedulerFeatureSchema", () => {
  it("applies defaults for an empty object", () => {
    const r = schedulerFeatureSchema.parse({});
    expect(r.enabled).toBe(false);
    expect(r.timezone).toBe("UTC");
    expect(r.missions).toEqual({});
  });

  it("accepts a missions map keyed by slug", () => {
    const r = schedulerFeatureSchema.safeParse({
      enabled: true,
      timezone: "Europe/Stockholm",
      missions: { "daily-summary": { enabled: true, cron: "0 20 * * *" } },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-slug mission id", () => {
    expect(
      schedulerFeatureSchema.safeParse({ missions: { "Bad Id": {} } }).success,
    ).toBe(false);
  });

  it("rejects an unknown top-level key (strict)", () => {
    expect(schedulerFeatureSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });
});
