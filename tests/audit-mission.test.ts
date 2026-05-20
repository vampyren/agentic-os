import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { auditMissionRun } from "../src/kernel/audit";

// auditMissionRun appends a `mission.run` JSONL line. A fresh audit
// dir per test keeps the assertion exact.

let auditDir: string;
let original: string | undefined;

beforeEach(async () => {
  auditDir = await fs.mkdtemp(path.join(os.tmpdir(), "audit-mission-"));
  original = process.env.AGENTIC_OS_AUDIT_DIR;
  process.env.AGENTIC_OS_AUDIT_DIR = auditDir;
});

afterEach(async () => {
  if (original === undefined) delete process.env.AGENTIC_OS_AUDIT_DIR;
  else process.env.AGENTIC_OS_AUDIT_DIR = original;
  await fs.rm(auditDir, { recursive: true, force: true });
});

async function readEntries(): Promise<Record<string, unknown>[]> {
  const day = new Date().toISOString().slice(0, 10);
  const raw = await fs.readFile(path.join(auditDir, `${day}.jsonl`), "utf8");
  return raw
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("auditMissionRun", () => {
  it("writes a mission.run entry with counts and status only", async () => {
    await auditMissionRun({
      missionId: "daily-summary",
      runId: "run-1",
      trigger: "manual",
      status: "success",
      durationMs: 12,
      outputsPersisted: 1,
      outputsEmitted: 0,
    });
    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.kind).toBe("mission.run");
    expect(e.missionId).toBe("daily-summary");
    expect(e.status).toBe("success");
    expect(e.outputsPersisted).toBe(1);
    expect(e.outputsEmitted).toBe(0);
    expect(typeof e.ts).toBe("string");
    expect(typeof e.id).toBe("string");
    expect(e.errorClass).toBeUndefined();
  });

  it("includes errorClass on a failed run", async () => {
    await auditMissionRun({
      missionId: "m",
      runId: "run-2",
      trigger: "manual",
      status: "failed",
      durationMs: 3,
      outputsPersisted: 0,
      outputsEmitted: 0,
      errorClass: "mission-threw",
    });
    const entries = await readEntries();
    expect(entries[0]!.errorClass).toBe("mission-threw");
  });
});
