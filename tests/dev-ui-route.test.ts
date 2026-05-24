import { describe, expect, it } from "vitest";
import DevUiPage from "../src/app/dev/ui/page";

// M4a-FU6 PR A — `/dev/ui` route smoke test.
//
// Asserts the page component imports + invokes without throwing.
// Scope is deliberately minimal: PR A ships a SKELETON (per the FU6
// task spec §11 PR A — "additive skeleton only, no live components,
// no consumer migration"). The richer per-state-matrix assertions
// land in PR B alongside the live component examples.
//
// This is a server component with static content; no DB, no API
// calls, no useState — so calling the function directly is enough
// to prove the import graph mounts. The FU5 PR A kernel
// test-isolation guard
// (src/kernel/state/db.ts::assertNotRealDbInTests) fires defensively
// if anything in the import graph ever resolves a state-DB
// singleton against the default path. We assert the page does NOT
// touch state.db by relying on that guard staying silent here.

describe("/dev/ui route smoke (M4a-FU6 PR A)", () => {
  it("DevUiPage renders without throwing", () => {
    expect(() => DevUiPage()).not.toThrow();
  });

  it("DevUiPage returns a non-null React element", () => {
    const element = DevUiPage();
    expect(element).toBeDefined();
    expect(element).not.toBeNull();
  });

  it("the page module exports a default function (Next.js page contract)", () => {
    expect(typeof DevUiPage).toBe("function");
    expect(DevUiPage.name).toBe("DevUiPage");
  });
});
