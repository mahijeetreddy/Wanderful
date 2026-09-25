import { expect, test } from "@playwright/test";
import { accessible } from "./accessibility";

test("weather watch only offers explicit recovery for current notices", async ({ page }, info) => {
  const trip = { id: "901", revision: 1, name: "Lisbon weather", destination: "Lisbon", savedAt: "2026-09-25", dateRange: "October", itinerary: "Plan", form: { currency_code: "USD" }, options: { hotels: [], flights: [] }, structuredItinerary: { days: [{ day_number: 2, date: "2026-10-23", title: "Museum day", activities: [] }] } };
  const previews: unknown[] = [];
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === "/api/auth/me") json = { user: { id: 701, name: "QA Traveler", status: "active" } };
    if (path === "/api/trips") json = { trips: [trip] };
    if (path.endsWith("/intelligence")) json = { health: { score: 90, grade: "excellent", issues: [], evidence: [], summary: "Ready" }, live: { events: [] }, constraints: {} };
    if (path.endsWith("/weather-monitoring")) json = { configured: true, enabled: true, trip, alerts: ["current", "resolved", "stale", "expired"].map(status => ({ id: status, date: "2026-10-23", message: `${status} forecast notice`, status })) };
    if (path.endsWith("/disruptions")) { previews.push(route.request().postDataJSON()); json = { scenarios: [] }; }
    await route.fulfill({ json });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open saved trips", exact: true }).click();
  await page.getByRole("button", { name: "Trip Health", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Trip command center", exact: true });
  await dialog.getByRole("tab", { name: "Trip Health", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(dialog.getByRole("tab", { name: "Disruption Autopilot", exact: true })).toHaveAttribute("aria-selected", "true");
  const recovery = dialog.getByRole("button", { name: "Preview indoor-day recovery", exact: true });
  await expect(recovery).toHaveCount(1);
  expect(previews).toEqual([]);
  await accessible(page, "dialog[open]");
  await dialog.screenshot({ path: `test-results/weather-${info.project.name}.png` });
  await recovery.press("Enter");
  await expect.poll(() => previews.length).toBe(1);
  expect(previews[0]).toEqual({ event: "rain", day_number: 2, apply: false });
});
