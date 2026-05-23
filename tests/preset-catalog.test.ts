import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadPresets, type ConnectorPreset } from "../src/kernel/connectors/presets";

let firstPartyDir: string;
let userDir: string;

beforeEach(async () => {
  firstPartyDir = await fs.mkdtemp(path.join(os.tmpdir(), "presets-first-"));
  userDir = await fs.mkdtemp(path.join(os.tmpdir(), "presets-user-"));
});

afterEach(async () => {
  await fs.rm(firstPartyDir, { recursive: true, force: true });
  await fs.rm(userDir, { recursive: true, force: true });
});

async function write(dir: string, name: string, body: unknown): Promise<void> {
  await fs.writeFile(path.join(dir, name), JSON.stringify(body), "utf8");
}

const VALID_OPENAI = {
  id: "openai",
  label: "OpenAI",
  typeFamily: "openai-compatible-llm",
  defaultSettings: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  trust: "first-party",
};

const VALID_OLLAMA = {
  id: "ollama-local",
  label: "Ollama (local)",
  typeFamily: "openai-compatible-llm",
  defaultSettings: { baseUrl: "http://localhost:11434/v1", model: "llama3" },
  allowLocalNetwork: true,
  trust: "first-party",
};

describe("loadPresets — first-party catalog", () => {
  it("loads valid first-party presets and preserves declared trust", async () => {
    await write(firstPartyDir, "openai.json", VALID_OPENAI);
    await write(firstPartyDir, "ollama.json", VALID_OLLAMA);
    const presets = await loadPresets({ firstPartyDir, userDir });
    const byId: Record<string, ConnectorPreset> = Object.fromEntries(
      presets.map((p) => [p.id, p]),
    );
    expect(byId.openai?.trust).toBe("first-party");
    expect(byId.openai?.defaultSettings).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
    });
    expect(byId["ollama-local"]?.allowLocalNetwork).toBe(true);
  });

  it("skips a malformed preset neutrally — others still load", async () => {
    await write(firstPartyDir, "good.json", VALID_OPENAI);
    await write(firstPartyDir, "bad.json", { id: "Bad Id", trust: "first-party" });
    const presets = await loadPresets({ firstPartyDir, userDir });
    expect(presets.map((p) => p.id)).toEqual(["openai"]);
  });

  it("skips a preset whose defaultSettings has a secret-looking key (B4)", async () => {
    await write(firstPartyDir, "leak.json", {
      ...VALID_OPENAI,
      id: "leak",
      defaultSettings: { baseUrl: "https://x", model: "m", apiKey: "sk-LEAK" },
    });
    const presets = await loadPresets({ firstPartyDir, userDir });
    expect(presets.map((p) => p.id)).not.toContain("leak");
  });
});

describe("loadPresets — user catalog trust clamp (B8)", () => {
  it("clamps a user preset that declares first-party down to community", async () => {
    await write(userDir, "rogue.json", { ...VALID_OPENAI, id: "rogue", trust: "first-party" });
    const presets = await loadPresets({ firstPartyDir, userDir });
    const rogue = presets.find((p) => p.id === "rogue");
    expect(rogue?.trust).toBe("community");
  });

  it("clamps a user preset declaring community to community (unchanged)", async () => {
    await write(userDir, "comm.json", { ...VALID_OPENAI, id: "comm", trust: "community" });
    const presets = await loadPresets({ firstPartyDir, userDir });
    expect(presets.find((p) => p.id === "comm")?.trust).toBe("community");
  });

  it("user-loaded presets honour the B4 secret-key screen too", async () => {
    await write(userDir, "leak.json", {
      ...VALID_OPENAI,
      id: "user-leak",
      defaultSettings: { token: "sk-LEAK" },
    });
    const presets = await loadPresets({ firstPartyDir, userDir });
    expect(presets.map((p) => p.id)).not.toContain("user-leak");
  });
});

describe("loadPresets — shipped first-party catalog", () => {
  it("the build's presets/ directory loads cleanly", async () => {
    const builtIn = path.join(process.cwd(), "presets");
    const presets = await loadPresets({ firstPartyDir: builtIn, userDir });
    expect(presets.map((p) => p.id).sort()).toEqual([
      "ollama-local",
      "openai",
      "openai-compatible-custom",
      "openrouter",
    ]);
    expect(presets.every((p) => p.trust === "first-party")).toBe(true);
  });
});
