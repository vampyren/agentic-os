import { describe, expect, it } from "vitest";
import {
  assertPublicBaseUrl,
  isPrivateIPv4,
  isPrivateIPv6,
  SsrfBlockError,
} from "../src/kernel/connectors/ssrf";
import { createOpenAiCompatibleLlmFamily } from "../src/connectors/openai-compatible-llm";

const PUBLIC_URL = "https://api.openai.com/v1";

// IP-literal blocks, plus DNS-resolved blocks via an injected resolver.

describe("isPrivateIPv4 / isPrivateIPv6", () => {
  it("flags every blocked IPv4 range", () => {
    expect(isPrivateIPv4("0.0.0.0")).toBe(true);
    expect(isPrivateIPv4("127.0.0.1")).toBe(true);
    expect(isPrivateIPv4("127.55.55.55")).toBe(true);
    expect(isPrivateIPv4("10.0.0.5")).toBe(true);
    expect(isPrivateIPv4("172.16.0.1")).toBe(true);
    expect(isPrivateIPv4("172.31.255.255")).toBe(true);
    expect(isPrivateIPv4("172.15.0.1")).toBe(false); // outside /12
    expect(isPrivateIPv4("172.32.0.1")).toBe(false); // outside /12
    expect(isPrivateIPv4("192.168.1.1")).toBe(true);
    expect(isPrivateIPv4("169.254.169.254")).toBe(true);
    expect(isPrivateIPv4("1.1.1.1")).toBe(false);
    expect(isPrivateIPv4("8.8.8.8")).toBe(false);
  });

  it("flags every blocked IPv6 range", () => {
    expect(isPrivateIPv6("::1")).toBe(true);
    expect(isPrivateIPv6("::")).toBe(true);
    expect(isPrivateIPv6("fc00::1")).toBe(true);
    expect(isPrivateIPv6("fd12::beef")).toBe(true);
    expect(isPrivateIPv6("fe80::1")).toBe(true);
    expect(isPrivateIPv6("febf::1")).toBe(true);
    expect(isPrivateIPv6("fec0::1")).toBe(false); // outside fe80::/10
    expect(isPrivateIPv6("2606:4700::1")).toBe(false); // public
  });
});

describe("assertPublicBaseUrl — IP literals", () => {
  const noResolver = async (): Promise<string[]> => {
    throw new Error("test should not need DNS");
  };

  it("passes for a public IPv4 baseUrl", async () => {
    await expect(
      assertPublicBaseUrl("https://1.1.1.1/v1", {
        allowLocalNetwork: false, resolver: noResolver,
      }),
    ).resolves.toBeUndefined();
  });

  it("blocks every private IPv4 baseUrl", async () => {
    const blocked = [
      "https://127.0.0.1/v1",
      "https://10.0.0.5/v1",
      "https://172.16.0.1/v1",
      "https://192.168.1.1/v1",
      "https://169.254.169.254/v1",
      "https://0.0.0.0/v1",
    ];
    for (const url of blocked) {
      await expect(
        assertPublicBaseUrl(url, { allowLocalNetwork: false, resolver: noResolver }),
      ).rejects.toBeInstanceOf(SsrfBlockError);
    }
  });

  it("blocks private IPv6 baseUrls", async () => {
    for (const url of ["https://[::1]/v1", "https://[fc00::1]/v1", "https://[fe80::1]/v1"]) {
      await expect(
        assertPublicBaseUrl(url, { allowLocalNetwork: false, resolver: noResolver }),
      ).rejects.toBeInstanceOf(SsrfBlockError);
    }
  });

  it("blocks the `localhost` hostname literal", async () => {
    await expect(
      assertPublicBaseUrl("http://localhost:1234/v1", {
        allowLocalNetwork: false, resolver: noResolver,
      }),
    ).rejects.toBeInstanceOf(SsrfBlockError);
  });

  it("allowLocalNetwork: true bypasses the guard", async () => {
    await expect(
      assertPublicBaseUrl("http://127.0.0.1:11434/v1", {
        allowLocalNetwork: true, resolver: noResolver,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(
      assertPublicBaseUrl("file:///etc/passwd", {
        allowLocalNetwork: false, resolver: noResolver,
      }),
    ).rejects.toBeInstanceOf(SsrfBlockError);
  });
});

describe("assertPublicBaseUrl — DNS-resolved hostnames", () => {
  it("blocks a hostname that resolves to a private IPv4 (no leak in error)", async () => {
    const privateAddr = "192.168.7.7";
    const resolver = async (): Promise<string[]> => [privateAddr];
    try {
      await assertPublicBaseUrl("https://example.test/v1", {
        allowLocalNetwork: false, resolver,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SsrfBlockError);
      expect(String((err as Error).message)).not.toContain(privateAddr);
    }
  });

  it("passes a hostname that resolves to a public address", async () => {
    const resolver = async (): Promise<string[]> => ["1.1.1.1"];
    await expect(
      assertPublicBaseUrl("https://example.test/v1", {
        allowLocalNetwork: false, resolver,
      }),
    ).resolves.toBeUndefined();
  });

  it("blocks if ANY resolved address is private (mixed A/AAAA)", async () => {
    const resolver = async (): Promise<string[]> => ["1.1.1.1", "fe80::1"];
    await expect(
      assertPublicBaseUrl("https://example.test/v1", {
        allowLocalNetwork: false, resolver,
      }),
    ).rejects.toBeInstanceOf(SsrfBlockError);
  });
});

describe("openai-compatible-llm family — redirects (B11)", () => {
  function fakeFetchReturning(
    status: number,
    headers: Record<string, string> = {},
    body: unknown = {},
  ): typeof fetch {
    return (async (_url: string | URL | Request) => {
      void _url;
      return new Response(JSON.stringify(body), { status, headers });
    }) as unknown as typeof fetch;
  }

  function ctx(secret = "sk-test") {
    return {
      connectorId: "openai",
      typeFamily: "openai-compatible-llm" as const,
      settings: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
      secret,
    };
  }

  it("a 302 -> http://127.0.0.1:1234 is a neutral failure; the Location never leaks", async () => {
    const family = createOpenAiCompatibleLlmFamily({
      fetch: fakeFetchReturning(302, { location: "http://127.0.0.1:1234/" }),
    });
    const res = await family.invoke(ctx(), "chat.generate", {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe("failed");
    expect(res.errorCode).toBe("network-unreachable");
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("Location");
  });

  it("a 302 -> http://169.254.169.254 (AWS metadata) is a neutral failure with no leak", async () => {
    const family = createOpenAiCompatibleLlmFamily({
      fetch: fakeFetchReturning(302, { location: "http://169.254.169.254/" }),
    });
    const res = await family.invoke(ctx(), "chat.generate", {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe("failed");
    expect(res.errorCode).toBe("network-unreachable");
    expect(JSON.stringify(res)).not.toContain("169.254.169.254");
  });

  it("a 200 with a chat-completion body returns success with text", async () => {
    const family = createOpenAiCompatibleLlmFamily({
      fetch: fakeFetchReturning(200, {}, {
        choices: [{ message: { content: "hello" } }],
      }),
    });
    const res = await family.invoke(ctx(), "chat.generate", {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe("success");
    expect((res.output as { text: string }).text).toBe("hello");
  });

  it("a 401 maps to errorCode auth-failed", async () => {
    const family = createOpenAiCompatibleLlmFamily({
      fetch: fakeFetchReturning(401, {}, {}),
    });
    const res = await family.invoke(ctx(), "chat.generate", {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.status).toBe("failed");
    expect(res.errorCode).toBe("auth-failed");
  });
});
