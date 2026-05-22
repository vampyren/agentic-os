import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAuthRef } from "../src/kernel/connectors/authRef";

const VAR = "AUTH_REF_TEST_KEY";
let original: string | undefined;

beforeEach(() => {
  original = process.env[VAR];
});
afterEach(() => {
  if (original === undefined) delete process.env[VAR];
  else process.env[VAR] = original;
});

describe("resolveAuthRef", () => {
  it("resolves env:VAR to the environment value", () => {
    process.env[VAR] = "sk-test-secret";
    expect(resolveAuthRef(`env:${VAR}`)).toEqual({
      ok: true,
      secret: "sk-test-secret",
    });
  });

  it("reports auth-missing for `none` and undefined", () => {
    expect(resolveAuthRef("none")).toEqual({ ok: false, errorCode: "auth-missing" });
    expect(resolveAuthRef(undefined)).toEqual({ ok: false, errorCode: "auth-missing" });
  });

  it("reports auth-missing for an unset or empty env var", () => {
    delete process.env[VAR];
    expect(resolveAuthRef(`env:${VAR}`)).toEqual({ ok: false, errorCode: "auth-missing" });
    process.env[VAR] = "";
    expect(resolveAuthRef(`env:${VAR}`)).toEqual({ ok: false, errorCode: "auth-missing" });
  });

  it("reports auth-malformed for a non-env-shaped ref", () => {
    const r = resolveAuthRef("just-a-raw-secret");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe("auth-malformed");
    expect(resolveAuthRef("env:").ok).toBe(false); // empty var name
  });

  it("a failed resolution never carries a `secret` field", () => {
    process.env[VAR] = "sk-do-not-leak";
    const r = resolveAuthRef("env:"); // malformed -> fails without leaking
    expect(r.ok).toBe(false);
    expect("secret" in r).toBe(false);
    expect(JSON.stringify(r)).not.toContain("sk-do-not-leak");
  });
});
