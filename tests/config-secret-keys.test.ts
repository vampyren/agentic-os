import { describe, expect, it } from "vitest";
import { connectorInstanceConfigSchema } from "../src/kernel/connectors/schema";

// B4 at the static config layer: a connector instance's `settings` is screened
// for secret-looking keys before the family schema ever runs.

describe("connector config — secret-looking settings keys (B4)", () => {
  it("accepts settings with only benign keys", () => {
    const r = connectorInstanceConfigSchema.safeParse({
      enabled: true,
      typeFamily: "openai-compatible-llm",
      settings: { baseUrl: "https://api.openai.com", model: "gpt-4o" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects settings.apiKey", () => {
    const r = connectorInstanceConfigSchema.safeParse({
      enabled: true,
      typeFamily: "openai-compatible-llm",
      settings: { apiKey: "sk-leak" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects settings.token", () => {
    const r = connectorInstanceConfigSchema.safeParse({
      enabled: true,
      typeFamily: "openai-compatible-llm",
      settings: { token: "leak" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects a secret-looking key nested inside settings", () => {
    const r = connectorInstanceConfigSchema.safeParse({
      enabled: true,
      typeFamily: "cli-acp-agent",
      settings: { auth: { client_secret: "leak" } },
    });
    expect(r.success).toBe(false);
  });
});
