// Registry resolution: manifests load from a builtin dir, user dir overrides
// builtin on name collision, unknown names return undefined.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import YAML from "yaml";
import { loadManifests } from "../src/kernel/manifest";

let tmpRoot: string;
let builtinDir: string;
let userDir: string;

async function writeManifest(dir: string, filename: string, manifest: object) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), YAML.stringify(manifest), "utf8");
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-test-"));
  builtinDir = path.join(tmpRoot, "builtin");
  userDir = path.join(tmpRoot, "user");
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("registry / manifest loading", () => {
  it("loads built-in manifests by name", async () => {
    await writeManifest(builtinDir, "claude-code.yaml", {
      name: "claude-code",
      displayName: "Claude Code",
      transport: "streamJson",
      transportConfig: {
        bin: "claude",
        args: ["-p", "{prompt}"],
      },
    });
    await writeManifest(builtinDir, "hermes.yaml", {
      name: "hermes",
      displayName: "Hermes Agent",
      transport: "subprocess",
      transportConfig: {
        bin: "hermes",
        args: ["-z", "{prompt}"],
      },
    });

    const manifests = await loadManifests({ builtinDir, userDir });
    const names = manifests.map((m) => m.name).sort();
    expect(names).toEqual(["claude-code", "hermes"]);

    const claude = manifests.find((m) => m.name === "claude-code");
    expect(claude?.transport).toBe("streamJson");
  });

  it("user manifests override builtin on name collision", async () => {
    await writeManifest(builtinDir, "claude.yaml", {
      name: "claude-code",
      displayName: "Builtin Claude",
      transport: "subprocess",
      transportConfig: { bin: "claude", args: ["-p", "{prompt}"] },
    });
    await writeManifest(userDir, "claude.yaml", {
      name: "claude-code",
      displayName: "User Override",
      transport: "streamJson",
      transportConfig: { bin: "claude", args: ["-p", "{prompt}"] },
    });

    const manifests = await loadManifests({ builtinDir, userDir });
    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.displayName).toBe("User Override");
    expect(manifests[0]?.transport).toBe("streamJson");
  });

  it("returns empty list when no manifests are present", async () => {
    const manifests = await loadManifests({ builtinDir, userDir });
    expect(manifests).toEqual([]);
  });

  it("rejects malformed manifests with a clear error", async () => {
    await writeManifest(builtinDir, "bad.yaml", {
      name: "BAD NAME WITH SPACES",
      displayName: "Bad",
      transport: "subprocess",
      transportConfig: { bin: "x", args: [] },
    });

    await expect(loadManifests({ builtinDir, userDir })).rejects.toThrow(/invalid manifest/);
  });
});
