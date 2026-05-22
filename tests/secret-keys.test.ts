import { describe, expect, it } from "vitest";
import {
  findSecretLookingKey,
  SECRET_LOOKING_KEYS,
} from "../src/kernel/connectors/secretKeys";

describe("findSecretLookingKey", () => {
  it("returns null for a clean settings object", () => {
    expect(
      findSecretLookingKey({ baseUrl: "https://api.x", model: "m", maxTokens: 10 }),
    ).toBeNull();
  });

  it("flags every secret-looking key form (top level)", () => {
    const forms = [
      "apiKey", "api_key", "token", "password", "bearer", "secret",
      "clientSecret", "client_secret", "accessToken", "access_token",
      "refreshToken", "refresh_token", "privateKey", "private_key",
    ];
    for (const key of forms) {
      expect(findSecretLookingKey({ [key]: "x" })).not.toBeNull();
    }
  });

  it("matches case-insensitively", () => {
    expect(findSecretLookingKey({ APIKEY: "x" })).not.toBeNull();
    expect(findSecretLookingKey({ Api_Key: "x" })).not.toBeNull();
    expect(findSecretLookingKey({ TOKEN: "x" })).not.toBeNull();
  });

  it("finds a secret-looking key nested inside objects", () => {
    expect(findSecretLookingKey({ a: { b: { token: "x" } } })).toBe("a.b.token");
  });

  it("finds a secret-looking key nested inside arrays", () => {
    expect(
      findSecretLookingKey({ items: [{ ok: 1 }, { apiKey: "x" }] }),
    ).toBe("items[1].apiKey");
  });

  it("SECRET_LOOKING_KEYS is non-empty and lower-cased", () => {
    expect(SECRET_LOOKING_KEYS.length).toBeGreaterThan(0);
    for (const k of SECRET_LOOKING_KEYS) expect(k).toBe(k.toLowerCase());
  });
});
