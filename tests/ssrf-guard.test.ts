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

  it("flags IPv4-mapped IPv6 addresses that encode a private IPv4 (B3)", () => {
    expect(isPrivateIPv6("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIPv6("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateIPv6("::ffff:10.0.0.5")).toBe(true);
    expect(isPrivateIPv6("::ffff:192.168.1.1")).toBe(true);
    // Hex-pair forms.
    expect(isPrivateIPv6("::ffff:7f00:1")).toBe(true);     // 127.0.0.1
    expect(isPrivateIPv6("::ffff:a9fe:a9fe")).toBe(true);  // 169.254.169.254
    // Public IPv4 mapped should NOT be flagged.
    expect(isPrivateIPv6("::ffff:1.1.1.1")).toBe(false);
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

  it("blocks private IPv6 baseUrls — via the LITERAL path, no DNS (B2)", async () => {
    // noResolver throws if DNS is reached — so these tests confirm the
    // bracketed-IPv6 literal is recognised by isIP() (B2 bracket strip).
    for (const url of ["https://[::1]/v1", "https://[fc00::1]/v1", "https://[fe80::1]/v1"]) {
      await expect(
        assertPublicBaseUrl(url, { allowLocalNetwork: false, resolver: noResolver }),
      ).rejects.toBeInstanceOf(SsrfBlockError);
    }
  });

  it("a PUBLIC IPv6 literal passes via the literal path (B2)", async () => {
    // If the bracket strip is missing, isIP() returns 0 and the guard would
    // fall through to DNS — which would throw under noResolver. Resolves
    // here only if the literal IPv6 path is correctly entered.
    await expect(
      assertPublicBaseUrl("https://[2606:4700::1]/v1", {
        allowLocalNetwork: false, resolver: noResolver,
      }),
    ).resolves.toBeUndefined();
  });

  it("blocks IPv4-mapped IPv6 baseUrls (B3)", async () => {
    for (const url of [
      "https://[::ffff:127.0.0.1]/v1",
      "https://[::ffff:169.254.169.254]/v1",
      "https://[::ffff:7f00:1]/v1",        // hex form of 127.0.0.1
      "https://[::ffff:a9fe:a9fe]/v1",     // hex form of 169.254.169.254
    ]) {
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

describe("openai-compatible-llm family — Bearer auth header (B1)", () => {
  function captureFetch(): {
    fetch: typeof fetch;
    captured: { authorization?: string; calls: number };
  } {
    const captured: { authorization?: string; calls: number } = { calls: 0 };
    const fn: typeof fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      captured.calls++;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      captured.authorization = headers.authorization;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    return { fetch: fn, captured };
  }

  it("sends `Authorization: Bearer <ctx.secret>` when a secret is present", async () => {
    const { fetch: fakeFetch, captured } = captureFetch();
    const family = createOpenAiCompatibleLlmFamily({ fetch: fakeFetch });
    await family.invoke(
      {
        connectorId: "openai",
        typeFamily: "openai-compatible-llm",
        settings: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
        secret: "sk-from-env",
      },
      "chat.generate",
      { messages: [{ role: "user", content: "hi" }] },
    );
    expect(captured.calls).toBe(1);
    expect(captured.authorization).toBe("Bearer sk-from-env");
  });

  it("omits Authorization for a no-auth (Ollama-style) instance", async () => {
    const { fetch: fakeFetch, captured } = captureFetch();
    const family = createOpenAiCompatibleLlmFamily({ fetch: fakeFetch });
    await family.invoke(
      {
        connectorId: "ollama",
        typeFamily: "openai-compatible-llm",
        settings: { baseUrl: "http://localhost:11434/v1", model: "llama3" },
      },
      "chat.generate",
      { messages: [{ role: "user", content: "hi" }] },
    );
    expect(captured.calls).toBe(1);
    expect(captured.authorization).toBeUndefined();
  });
});
