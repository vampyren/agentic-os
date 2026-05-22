// UI-safe feature projection (Phase 1C — M1).
//
// Proves toUiSafeFeature never leaks a config schema, config defaults,
// a health function, or a raw filesystem path to the browser — and
// that the DEEP allowlist drops anything not explicitly named inside
// `status` (reasons) and `exposures`.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toUiSafeFeature } from "../src/kernel/features/projection";
import type { ResolvedFeature } from "../src/kernel/features/resolver";
import type { FeatureModule } from "../src/kernel/features/types";

const SECRET_PATH = "/home/operator/.secrets/vault-token";

function resolved(): ResolvedFeature {
  const module: FeatureModule = {
    id: "sensitive",
    title: "Sensitive Feature",
    description: "carries secrets in its non-UI-safe fields",
    category: "automation",
    lifecycle: { defaultEnabled: true, canDisable: true },
    config: {
      schema: z.object({ apiKey: z.string() }),
      defaults: { apiKey: "super-secret-default-value" },
    },
    sideEffects: ["vault-write"],
    vault: { allowedWriteRoots: [SECRET_PATH] },
    artifacts: { allowedRoots: [SECRET_PATH] },
    health: async () => ({ status: "ok" }),
  };
  return {
    module,
    exposures: { featureId: "sensitive" },
    status: { state: "ready", visibility: "visible", reasons: [] },
  };
}

describe("toUiSafeFeature", () => {
  it("includes id, title, description, category, canDisable, status and exposures", () => {
    const safe = toUiSafeFeature(resolved());
    expect(safe.id).toBe("sensitive");
    expect(safe.title).toBe("Sensitive Feature");
    expect(safe.description).toContain("secrets");
    expect(safe.category).toBe("automation");
    expect(safe.canDisable).toBe(true);
    expect(safe.status.state).toBe("ready");
    expect(safe.exposures.featureId).toBe("sensitive");
  });

  it("carries the lifecycle canDisable flag both ways", () => {
    expect(toUiSafeFeature(resolved()).canDisable).toBe(true);
    const r = resolved();
    r.module.lifecycle = { ...r.module.lifecycle, canDisable: false };
    expect(toUiSafeFeature(r).canDisable).toBe(false);
  });

  it("does NOT include the config block (schema or defaults)", () => {
    const safe = toUiSafeFeature(resolved()) as unknown as Record<
      string,
      unknown
    >;
    expect(safe.config).toBeUndefined();
  });

  it("does NOT include the health function reference", () => {
    const safe = toUiSafeFeature(resolved()) as unknown as Record<
      string,
      unknown
    >;
    expect(safe.health).toBeUndefined();
    expect(safe.vault).toBeUndefined();
    expect(safe.artifacts).toBeUndefined();
  });

  it("output is JSON-serializable — no functions, no schemas", () => {
    const safe = toUiSafeFeature(resolved());
    const json = JSON.stringify(safe);
    expect(typeof json).toBe("string");
    // A round-trip preserves the shape exactly.
    expect(JSON.parse(json)).toEqual(safe);
  });

  it("output contains no raw filesystem path from vault/artifacts roots", () => {
    const json = JSON.stringify(toUiSafeFeature(resolved()));
    expect(json).not.toContain(SECRET_PATH);
    expect(json).not.toContain("/home/");
    expect(json).not.toContain("super-secret-default-value");
  });
});

// ── Deep allowlist: status / reasons ────────────────────────────────

const HEALTH_SECRET = "/home/operator/.secrets/health-probe-token";

function resolvedWithReason(): ResolvedFeature {
  const base = resolved();
  return {
    ...base,
    status: {
      state: "degraded",
      visibility: "visible",
      reasons: [
        // A reason whose `message` carries a raw health probe string,
        // plus a stray field that must NOT survive projection.
        {
          code: "health-degraded",
          severity: "warn",
          message: `probe failed reading ${HEALTH_SECRET}`,
          // @ts-expect-error — intentionally injected non-allowlisted field
          internalDetail: HEALTH_SECRET,
        },
      ],
    },
  };
}

describe("toUiSafeFeature — status / reason projection", () => {
  it("derives the reason message from its code, never the raw health text", () => {
    const safe = toUiSafeFeature(resolvedWithReason());
    expect(safe.status.reasons).toHaveLength(1);
    const reason = safe.status.reasons[0]!;
    expect(reason.code).toBe("health-degraded");
    expect(reason.severity).toBe("warn");
    expect(reason.message).toBe("The feature reports degraded health.");
    expect(reason.message).not.toContain(HEALTH_SECRET);
  });

  it("drops fields on a reason that are not on the allowlist", () => {
    const safe = toUiSafeFeature(resolvedWithReason());
    const reason = safe.status.reasons[0] as unknown as Record<
      string,
      unknown
    >;
    expect(reason.internalDetail).toBeUndefined();
    expect(Object.keys(reason).sort()).toEqual(["code", "message", "severity"]);
    expect(JSON.stringify(safe)).not.toContain(HEALTH_SECRET);
  });
});

// ── Deep allowlist: exposures ───────────────────────────────────────

function resolvedWithExposures(): ResolvedFeature {
  const base = resolved();
  return {
    ...base,
    exposures: {
      featureId: "sensitive",
      nav: [
        {
          id: "nav-1",
          label: "Scheduler",
          href: "/scheduler",
          iconKey: "clock",
          order: 1,
          // @ts-expect-error — stray field must not survive
          secretToken: HEALTH_SECRET,
        },
      ],
      commands: [
        {
          id: "cmd-ok",
          label: "Open Scheduler",
          action: { type: "navigate", href: "/scheduler" },
        },
        {
          id: "cmd-bad",
          label: "Mystery",
          // @ts-expect-error — unknown action type → whole command dropped
          action: { type: "exfiltrate", payload: HEALTH_SECRET },
        },
      ],
    },
  };
}

describe("toUiSafeFeature — exposures projection", () => {
  it("drops stray fields on a nav exposure", () => {
    const safe = toUiSafeFeature(resolvedWithExposures());
    const nav = safe.exposures.nav?.[0] as unknown as Record<string, unknown>;
    expect(nav.secretToken).toBeUndefined();
    expect(Object.keys(nav).sort()).toEqual([
      "href",
      "iconKey",
      "id",
      "label",
      "order",
    ]);
  });

  it("drops a command whose action type is not recognised", () => {
    const safe = toUiSafeFeature(resolvedWithExposures());
    expect(safe.exposures.commands).toHaveLength(1);
    expect(safe.exposures.commands?.[0]?.id).toBe("cmd-ok");
    expect(JSON.stringify(safe)).not.toContain(HEALTH_SECRET);
    expect(JSON.stringify(safe)).not.toContain("exfiltrate");
  });
});
