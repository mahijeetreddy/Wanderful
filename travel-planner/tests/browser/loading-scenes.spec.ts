import { expect, test } from "@playwright/test";
import { accessible } from "./accessibility";

test("themed loading scenes respect motion preferences and finish with results", async ({ page }) => {
  let complete = false;
  const options = { flights: [], hotels: [], flight_recovery: [], map_center: { lat: 38.72, lng: -9.14 }, provider_status: { flights: "searching", hotels: "searching" } };
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === "/api/auth/me") json = { user: { id: 701, name: "QA Traveler", status: "active" } };
    else if (path === "/api/trips") json = { trips: [] };
    else if (path === "/api/plan-jobs" && route.request().method() === "POST") json = { job_id: "loading-fixture" };
    else if (path === "/api/plan-jobs/loading-fixture") json = { job: { id: "loading-fixture", status: complete ? "complete" : "planning", progress: "Drafting your trip", options: { ...options, provider_status: complete ? { flights: "empty", hotels: "empty" } : options.provider_status }, ...(complete ? { itinerary: "# Lisbon\nYour plan is ready.", structured_itinerary: { days: [] } } : {}) } };
    await route.fulfill({ json });
  });
  await page.addInitScript(() => {
    localStorage.setItem("wanderful.currentTrip.v3:user-701", JSON.stringify({ form: { origin: "LAX", destination: "Lisbon", start_date: "2027-05-01", end_date: "2027-05-02", budget: "3000", adults: "1", currency_code: "USD", interests: "history" }, options: { flights: [], hotels: [], flight_recovery: [], map_center: null }, itinerary: "", resultTab: "itinerary" }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Build my trip", exact: true }).click();
  await expect(page.locator('[data-loading-theme="itinerary"]').first()).toBeVisible();
  await page.getByRole("tab", { name: "Flights", exact: true }).click();
  const flight = page.locator('[data-loading-theme="flights"]').first();
  await expect(flight).toBeVisible();
  await flight.screenshot({ path: `test-results/loading-flight-${test.info().project.name}.png` });
  expect(await flight.locator(".travel-loading__plane").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  await accessible(page, ".travel-loading");
  await page.getByRole("tab", { name: "Stays", exact: true }).click();
  await expect(page.locator('[data-loading-theme="stays"]').first()).toBeVisible();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.locator('[data-loading-theme="stays"]').first().screenshot({ path: `test-results/loading-stay-${test.info().project.name}.png` });
  await accessible(page, ".travel-loading");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const main = page.locator('[data-loading-theme="itinerary"]').first();
  await main.getByRole("button", { name: "Pause animation" }).click();
  await expect(main).toHaveAttribute("data-paused", "true");
  await page.screenshot({ path: `test-results/loading-scenes-${test.info().project.name}.png`, fullPage: true });
  complete = true;
  await expect(page.locator(".travel-loading")).toHaveCount(0);
});
