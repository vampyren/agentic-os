import { describe, it, expect } from "vitest";
import { detectSeverity } from "../src/lib/severity";

describe("detectSeverity", () => {
  it("returns null for empty / null / undefined / non-string input", () => {
    expect(detectSeverity(undefined)).toBeNull();
    expect(detectSeverity(null)).toBeNull();
    expect(detectSeverity("")).toBeNull();
    // @ts-expect-error — deliberate runtime weirdness
    expect(detectSeverity(123)).toBeNull();
    // @ts-expect-error — deliberate runtime weirdness
    expect(detectSeverity({})).toBeNull();
  });

  it("returns null when no severity keywords present", () => {
    expect(detectSeverity("all good")).toBeNull();
    expect(detectSeverity("running fine, 200 OK")).toBeNull();
  });

  it("returns 'warn' for uppercase WARN / WARNING / DEGRADED / DEPRECATED / UNHEALTHY", () => {
    expect(detectSeverity("status: WARN")).toBe("warn");
    expect(detectSeverity("WARNING: slow probe")).toBe("warn");
    expect(detectSeverity("hermes: DEGRADED")).toBe("warn");
    expect(detectSeverity("DEPRECATED in v2")).toBe("warn");
    expect(detectSeverity("vault UNHEALTHY")).toBe("warn");
  });

  it("returns 'err' for uppercase ERROR / CRITICAL / FATAL / FAIL / FAILED / FAILURE / PANIC / OFFLINE", () => {
    expect(detectSeverity("ERROR: missing dep")).toBe("err");
    expect(detectSeverity("CRITICAL")).toBe("err");
    expect(detectSeverity("FATAL signal 11")).toBe("err");
    expect(detectSeverity("test FAIL")).toBe("err");
    expect(detectSeverity("install FAILED")).toBe("err");
    expect(detectSeverity("FAILURE in step 3")).toBe("err");
    expect(detectSeverity("kernel PANIC")).toBe("err");
    expect(detectSeverity("agent OFFLINE")).toBe("err");
  });

  it("returns 'err' when both warn and err keywords appear (err outranks warn)", () => {
    expect(detectSeverity("WARN: starting up\nERROR: failed")).toBe("err");
  });

  it("does NOT trip on lowercase prose like 'warning' or 'error'", () => {
    // Conservative by design — model output sentences must not light up
    // the badge. Real CLI status dumps print uppercase tokens.
    expect(detectSeverity("we issued a warning about deprecation")).toBeNull();
    expect(detectSeverity("error: this is a casual error mention")).toBeNull();
    expect(detectSeverity("fail")).toBeNull();
    expect(detectSeverity("failed")).toBeNull();
  });

  it("respects word boundaries — does NOT trip on substrings", () => {
    expect(detectSeverity("ERRORLESS run")).toBeNull();
    expect(detectSeverity("WARNFUL")).toBeNull();
    expect(detectSeverity("UNFAILING")).toBeNull();
  });

  it("matches in the middle of mixed-case text", () => {
    expect(detectSeverity("checking modules... [WARN] slow probe")).toBe("warn");
    expect(detectSeverity("status check pass\n[ERROR] missing key")).toBe("err");
  });
});
