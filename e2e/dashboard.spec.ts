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
    await input.fill("e2e smoke test goal");
    await page.getByRole("button", { name: /Add/ }).click();
    await expect(page.getByText("e2e smoke test goal")).toBeVisible();
  });

  test("journal page lets you log an entry", async ({ page }) => {
    await page.goto("/journal");
    const ta = page.getByPlaceholder(/What's on your mind/i);
    await ta.fill("e2e smoke journal entry");
    await page.getByRole("button", { name: /^Log/ }).click();
    await expect(page.getByText("e2e smoke journal entry")).toBeVisible();
  });
});
