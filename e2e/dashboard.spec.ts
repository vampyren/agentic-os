// Phase 1B smoke tests. Verifies the dashboard renders end-to-end without
// depending on real agent CLIs being installed on the test runner.

import { test, expect } from "@playwright/test";

test.describe("Mission Control dashboard", () => {
  test("the home page loads and shows the agents section", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Agents/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Live activity/i })).toBeVisible();
  });

  test("the sidebar links route correctly", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /^Goals/ }).click();
    await expect(page).toHaveURL(/\/goals$/);
    await expect(page.getByRole("heading", { name: /^Goals/ })).toBeVisible();

    await page.getByRole("link", { name: /^Journal/ }).click();
    await expect(page).toHaveURL(/\/journal$/);
    await expect(page.getByRole("heading", { name: /Journal —/ })).toBeVisible();

    await page.getByRole("link", { name: /^Memory/ }).click();
    await expect(page).toHaveURL(/\/memory$/);
    await expect(page.getByPlaceholder("search notes…")).toBeVisible();

    await page.getByRole("link", { name: /Event Log/ }).click();
    await expect(page).toHaveURL(/\/events$/);
    await expect(page.getByRole("heading", { name: /Event log/i })).toBeVisible();
  });

  test("/api/agents responds with JSON shape", async ({ request }) => {
    const r = await request.get("/api/agents");
    expect(r.ok()).toBeTruthy();
    const json = await r.json();
    expect(Array.isArray(json.agents)).toBe(true);
    // Built-in manifests should be present.
    const names = json.agents.map((a: { name: string }) => a.name);
    expect(names).toContain("claude-code");
    expect(names).toContain("hermes");
  });

  test("goals page lets you add a goal and see it appear", async ({ page }) => {
    await page.goto("/goals");
    const input = page.getByPlaceholder("What's the goal?");
    // Use a unique title per run so we never collide with leftover state.
    const title = `e2e smoke goal ${Date.now()}`;
    await input.fill(title);
    await page.getByRole("button", { name: /Add/ }).click();
    // Input clears on successful POST + reload — wait for that signal first.
    await expect(input).toHaveValue("", { timeout: 10_000 });
    // Then assert the goal is in the list.
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
  });

  test("journal page lets you log an entry", async ({ page }) => {
    await page.goto("/journal");
    const ta = page.getByPlaceholder(/What's on your mind/i);
    const entry = `e2e smoke journal entry ${Date.now()}`;
    await ta.fill(entry);
    await page.getByRole("button", { name: /^Log/ }).click();
    await expect(ta).toHaveValue("", { timeout: 10_000 });
    await expect(page.getByText(entry)).toBeVisible({ timeout: 10_000 });
  });

  // Helper: wait for AgentRoom to actually mount (and import chatStore,
  // which sets the globalThis singleton we reach into below).
  async function injectChatMessage(page: import("@playwright/test").Page, agent: string, marker: string) {
    await page.goto(`/agents/${agent}`);
    await page.getByPlaceholder(/Type a prompt/i).waitFor({ state: "visible", timeout: 10_000 });
    // Now AgentRoom is mounted; chatStore module is imported; singleton exists.
    // Poll the page eval up to a few times in case React still hydrating.
    await page.waitForFunction(() => {
      const w = window as unknown as { __agenticChatStore?: unknown };
      return Boolean(w.__agenticChatStore);
    }, { timeout: 10_000 });
    await page.evaluate(({ agent: a, marker: m }) => {
      const w = window as unknown as { __agenticChatStore?: { appendUserMessage: (a: string, t: string) => void } };
      w.__agenticChatStore!.appendUserMessage(a, m);
    }, { agent, marker });
  }

  test("chat persistence — message survives navigation between agents", async ({ page }) => {
    // Drives the chatStore directly via globalThis; doesn't require a real
    // CLI on the CI runner. Proves AgentRoom unmount doesn't lose state.
    const marker = `e2e-persistence-${Date.now()}`;
    await injectChatMessage(page, "claude-code", marker);
    await expect(page.getByText(marker)).toBeVisible({ timeout: 5_000 });

    // Navigate away and back.
    await page.goto("/agents/hermes");
    await page.getByPlaceholder(/Type a prompt/i).waitFor({ state: "visible" });
    await page.goto("/agents/claude-code");

    // Message must still be there.
    await expect(page.getByText(marker)).toBeVisible({ timeout: 10_000 });
  });

  test("chat persistence — New session button clears the agent's history", async ({ page }) => {
    const marker = `e2e-clear-${Date.now()}`;
    await injectChatMessage(page, "claude-code", marker);
    await expect(page.getByText(marker)).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: /New session/i }).click();
    await expect(page.getByText(marker)).not.toBeVisible({ timeout: 5_000 });
  });

  // Regression test for v0.2.10 AgentRoom unmount cleanup, carried forward
  // for v0.2.11 per Hermes v0.2.8 review. The route-switch path was the
  // gap SECURITY.md was claiming-but-not-delivering. Intercept the run
  // endpoint with a hung response, start a stream, navigate to a different
  // agent, then back, and assert:
  //   - Stop button is hidden in the new room
  //   - Textarea is enabled in the new room
  //   - No orphan assistant message ever landed in either visible chat
  test("route switch during in-flight stream — no orphan commits, no stale streaming UI", async ({ page }) => {
    // Intercept the run endpoint for claude-code so a triggered send hangs
    // indefinitely. Playwright's route handler will time out on the 30s
    // default — that's fine, the test never actually awaits the response.
    // We just want streaming = true so the Stop button appears, then we
    // navigate away to trigger the unmount cleanup.
    await page.route("**/api/agents/claude-code/run", async () => {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      // Connection will be dropped when the test ends — we never fulfill.
    });

    // Visit claude-code room and trigger a send.
    await page.goto("/agents/claude-code");
    const promptBox = page.getByPlaceholder(/Type a prompt/i);
    await promptBox.waitFor({ state: "visible", timeout: 10_000 });
    const marker = `e2e-route-switch-${Date.now()}`;
    await promptBox.fill(marker);
    await page.getByRole("button", { name: /^Send/ }).click();

    // The user message appears immediately (appendUserMessage runs before
    // fetch). The Stop button replaces Send while streaming.
    await expect(page.getByText(marker)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /^Stop/ })).toBeVisible({ timeout: 5_000 });

    // Navigate to a different agent. This unmounts the claude-code
    // AgentRoom, fires the [name] cleanup useEffect, bumps the generation
    // counter, and aborts the fetch.
    await page.goto("/agents/hermes");
    await page.getByPlaceholder(/Type a prompt/i).waitFor({ state: "visible", timeout: 10_000 });

    // In the hermes room:
    //   - Stop must NOT be visible (no inherited streaming state)
    //   - Textarea must be enabled (not stuck in disabled-during-streaming)
    //   - The marker must NOT appear (per-agent isolation)
    await expect(page.getByRole("button", { name: /^Stop/ })).not.toBeVisible();
    await expect(page.getByPlaceholder(/Type a prompt/i)).toBeEnabled();
    await expect(page.getByText(marker)).not.toBeVisible();

    // Navigate back to claude-code. The user marker should still be there
    // (per-agent chat persistence), but the streaming UI must be cleared
    // and NO "(no output)" orphan assistant message should have been
    // committed by the cancelled run's finally block.
    await page.goto("/agents/claude-code");
    await page.getByPlaceholder(/Type a prompt/i).waitFor({ state: "visible", timeout: 10_000 });
    await expect(page.getByText(marker)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /^Stop/ })).not.toBeVisible();
    await expect(page.getByPlaceholder(/Type a prompt/i)).toBeEnabled();
    // The smoking gun: if generation guard or abort failed, the finally
    // block would have written "(no output)" into the cleared session.
    await expect(page.getByText("(no output)")).not.toBeVisible({ timeout: 2_000 });
  });

  test("agent workspace — Chat / Control Room mode toggle (v0.2.11 layout)", async ({ page }) => {
    // Hermes declares actions → both pills render. The default mode is
    // Chat, so the textarea is visible. Switching to Control Room hides
    // the chat textarea and shows the action rail header. Switching back
    // restores the chat (per-agent chat persistence survives the toggle).
    await page.goto("/agents/hermes");
    await page.getByPlaceholder(/Type a prompt/i).waitFor({ state: "visible", timeout: 10_000 });

    // Both mode pills present.
    const chatPill = page.getByRole("tab", { name: /^Chat$/ });
    const controlPill = page.getByRole("tab", { name: /^Control Room$/ });
    await expect(chatPill).toBeVisible();
    await expect(controlPill).toBeVisible();
    await expect(chatPill).toHaveAttribute("aria-selected", "true");

    // Switch to Control Room → chat textarea hidden, actions list visible.
    await controlPill.click();
    await expect(controlPill).toHaveAttribute("aria-selected", "true");
    await expect(page.getByPlaceholder(/Type a prompt/i)).not.toBeVisible();
    // The "ACTIONS" label in the left rail.
    await expect(page.getByText(/^Actions$/).first()).toBeVisible();
    // At least one action row by label (Status is first).
    await expect(page.getByRole("button", { name: /^Status\s+env$/ })).toBeVisible();

    // Switch back → chat restored.
    await chatPill.click();
    await expect(chatPill).toHaveAttribute("aria-selected", "true");
    await expect(page.getByPlaceholder(/Type a prompt/i)).toBeVisible();
  });

  test("Control Room — Claude (no actions) does NOT render mode toggle", async ({ page }) => {
    // Claude manifest declares no `actions:` block. The mode toggle is
    // visible only when actions exist, so Claude stays chat-only by
    // construction. Verifies the per-agent differentiation in the
    // workspace wrapper (mirrors Julian's claude/page.tsx).
    await page.goto("/agents/claude-code");
    await page.getByPlaceholder(/Type a prompt/i).waitFor({ state: "visible", timeout: 10_000 });
    await expect(page.getByRole("tab", { name: /^Control Room$/ })).not.toBeVisible();
    // Chat textarea is the default and only mode.
    await expect(page.getByPlaceholder(/Type a prompt/i)).toBeVisible();
  });

  test("Control Room action — runs declared action, viewer renders, chat path unaffected", async ({ page, request }) => {
    // Action endpoint is best-effort: real `hermes` may or may not be on
    // the CI runner's PATH. The contract under test is that the action
    // row renders, navigating to Control Room triggers a run (default
    // action seeds), the viewer shows a result (ok OR a neutral error),
    // and the chat textarea remains enabled when we switch back.
    const list = await request.get("/api/agents");
    const json = await list.json() as { agents: Array<{ name: string; actions?: Array<{ id: string }> }> };
    const hermes = json.agents.find((a) => a.name === "hermes");
    if (!hermes || !hermes.actions || hermes.actions.length === 0) {
      test.skip(true, "hermes manifest exposes no actions");
      return;
    }

    await page.goto("/agents/hermes");
    await page.getByPlaceholder(/Type a prompt/i).waitFor({ state: "visible", timeout: 10_000 });

    // Enter Control Room.
    await page.getByRole("tab", { name: /^Control Room$/ }).click();

    // Default action (Status) auto-runs on mount. Wait for the viewer
    // footer's "Last run · HH:MM:SS" line OR a classified error in the
    // body — either signals the request resolved.
    await expect(
      page.locator("text=/Last run · |spawn-failed|non-zero-exit|timeout|killed|transport-error/").first(),
    ).toBeVisible({ timeout: 10_000 });

    // Click a different row (Doctor) and confirm the right viewer
    // re-renders with its header.
    await page.getByRole("button", { name: /^Doctor\s+check$/ }).click();
    await expect(page.locator("text=hermes · doctor").first()).toBeVisible({ timeout: 5_000 });

    // Viewer must use non-wrapping monospace + horizontal-scroll layout.
    // The data-testid lives on the <pre> only when output is rendered;
    // it's absent for error-only states, so guard the assertion.
    const out = page.getByTestId("action-output").first();
    if (await out.count()) {
      const ws = await out.evaluate((el) => getComputedStyle(el).whiteSpace);
      // Action output must NOT wrap. Acceptable values:
      // "pre" (Tailwind whitespace-pre) or "break-spaces"-derived
      // variants. Reject "normal" / "pre-wrap" / "pre-line".
      expect(["pre", "break-spaces"]).toContain(ws);
    }

    // Switch back to chat — textarea must be enabled and intact.
    await page.getByRole("tab", { name: /^Chat$/ }).click();
    await expect(page.getByPlaceholder(/Type a prompt/i)).toBeEnabled();
  });
});
