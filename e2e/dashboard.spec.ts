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
});
