// Secret-looking-key rejection (M4a-1, spec §7 / B4).
//
// A connector instance's `settings` (and a preset's `defaultSettings`) carry
// family config — baseUrl, model, bin, … — and must NEVER carry a secret. A
// secret reaches a connector only as a resolved `authRef` (authRef.ts).
//
// This module screens settings objects for secret-looking keys at ANY depth,
// including nested objects and arrays.

/** The rejected key names — both camelCase and snake_case forms, lower-cased. */
export const SECRET_LOOKING_KEYS: readonly string[] = [
  "apikey", "api_key", "token", "password", "bearer", "secret",
  "clientsecret", "client_secret", "accesstoken", "access_token",
  "refreshtoken", "refresh_token", "privatekey", "private_key",
];

const SECRET_SET = new Set(SECRET_LOOKING_KEYS);

/**
 * Walk `value` (objects + arrays, any depth) and return the path of the first
 * secret-looking key found, or `null` if there is none. Key match is
 * case-insensitive.
 */
export function findSecretLookingKey(
  value: unknown,
  pathPrefix = "",
): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSecretLookingKey(value[i], `${pathPrefix}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const here = pathPrefix ? `${pathPrefix}.${key}` : key;
      if (SECRET_SET.has(key.toLowerCase())) return here;
      const hit = findSecretLookingKey(child, here);
      if (hit) return hit;
    }
  }
  return null;
}
