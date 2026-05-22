import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  getRunLedger,
  resetRunLedgerForTests,
} from "../src/kernel/state/runLedger";
import { closeStateDbForTests } from "../src/kernel/state/db";
import { GET as listRuns } from "../src/app/api/runs/route";
import { GET as getRun } from "../src/app/api/runs/[id]/route";
import { POST as cancelRun } from "../src/app/api/runs/[id]/cancel/route";

// The routes use the getRunLedger() singleton; the test seeds through the same
// singleton, against a tmp-file state DB via AGENTIC_OS_STATE_DB.

let tmpDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-runs-"));
  originalEnv = process.env.AGENTIC_OS_STATE_DB;
  process.env.AGENTIC_OS_STATE_DB = path.join(tmpDir, "state.db");
});

afterEach(async () => {
  closeStateDbForTests();
  resetRunLedgerForTests();
  if (originalEnv === undefined) delete process.env.AGENTIC_OS_STATE_DB;
  else process.env.AGENTIC_OS_STATE_DB = originalEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const BASE = "http://127.0.0.1:3000/api/runs";
const GET_REQ = (url: string) => new Request(url);
const POST_REQ = (url: string) => new Request(url, { method: "POST" });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function newRun(featureId = "scheduler") {
  return getRunLedger().then((ledger) =>
    ledger.createRun({
      kind: "manual-mission",
      featureId,
      trigger: "manual",
      onRestart: "mark-interrupted",
    }),
  );
}

describe("/api/runs", () => {
  it("lists runs newest-first and filters by status", async () => {
    const ledger = await getRunLedger();
    const a = ledger.createRun({
      kind: "manual-mission", featureId: "scheduler",
      trigger: "manual", onRestart: "mark-interrupted",
    });
    const b = ledger.createRun({
      kind: "scheduled-mission", featureId: "scheduler",
      trigger: "scheduled", onRestart: "mark-interrupted",
    });
    ledger.transitionRun(a.id, "succeeded");

    const res = await listRuns(GET_REQ(BASE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.runs.map((r: { id: string }) => r.id)).toEqual([b.id, a.id]);

    const filtered = await listRuns(GET_REQ(`${BASE}?status=succeeded`));
    const fbody = await filtered.json();
    expect(fbody.runs.map((r: { id: string }) => r.id)).toEqual([a.id]);
  });

  it("rejects an unknown status filter with a neutral 400", async () => {
    const res = await listRuns(GET_REQ(`${BASE}?status=bogus`));
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
  });

  it("returns a run with its steps and external refs", async () => {
    const ledger = await getRunLedger();
    const run = await newRun();
    ledger.appendStep(run.id, { kind: "mission.run" });
    ledger.addExternalRef(run.id, { system: "hermes", kind: "task", id: "t-1" });

    const res = await getRun(GET_REQ(`${BASE}/${run.id}`), params(run.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.id).toBe(run.id);
    expect(body.steps).toHaveLength(1);
    expect(body.externalRefs).toEqual([
      { system: "hermes", kind: "task", id: "t-1" },
    ]);
  });

  it("404s with a neutral error for an unknown run id", async () => {
    const res = await getRun(GET_REQ(`${BASE}/nope`), params("nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).ok).toBe(false);
  });

  it("cancels a running run, then 409s a second cancel of the terminal run", async () => {
    const run = await newRun();

    const ok = await cancelRun(POST_REQ(`${BASE}/${run.id}/cancel`), params(run.id));
    expect(ok.status).toBe(200);
    expect((await ok.json()).run.status).toBe("cancelled");

    const again = await cancelRun(
      POST_REQ(`${BASE}/${run.id}/cancel`),
      params(run.id),
    );
    expect(again.status).toBe(409);
    expect((await again.json()).ok).toBe(false);
  });

  it("redacts a path/secret-like inputSummary and never leaks it", async () => {
    const ledger = await getRunLedger();
    const run = ledger.createRun({
      kind: "manual-mission", featureId: "scheduler",
      trigger: "manual", onRestart: "mark-interrupted",
      inputSummary: "leaked /home/operator/.secrets/token",
    });

    const listText = await (await listRuns(GET_REQ(BASE))).text();
    expect(listText).not.toContain("/home/operator/.secrets/token");

    const detailText = await (
      await getRun(GET_REQ(`${BASE}/${run.id}`), params(run.id))
    ).text();
    expect(detailText).not.toContain("/home/operator/.secrets/token");
    expect(JSON.parse(detailText).run.inputSummary).toBe("[redacted]");
  });

  it("rejects a cross-site request with 403", async () => {
    const res = await listRuns(
      new Request(BASE, { headers: { origin: "http://evil.example" } }),
    );
    expect(res.status).toBe(403);
  });
});
