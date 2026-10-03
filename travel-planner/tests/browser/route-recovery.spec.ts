import { expect, test } from "@playwright/test";
import { accessible } from "./accessibility";

test("route keeps verified stops, retries missing places, and supports light mode", async ({ page }, info) => {
  const point = { lat: 38.71, lng: -9.14 };
  const trip = { id: "901", revision: 1, name: "Lisbon route", destination: "Lisbon", savedAt: "2026-09-29", dateRange: "May", itinerary: "Plan", form: { origin: "LAX", destination: "Lisbon", start_date: "2027-05-01", end_date: "2027-05-03", budget: "2500", currency_code: "USD", adults: "1", interests: "Art" }, options: { hotels: [], flights: [], map_center: point }, structuredItinerary: { days: [{ day_number: 1, date: "2027-05-01", title: "Explore the city", activities: [{ title: "Museum", location: "City Museum", coordinates: point, source_id: "museum", source_url: "https://example.com/museum" }, { title: "Garden", location: "City Garden" }] }] } };
  let lookups = 0;
  let recover = false;
  // Do not fetch public map tiles from automated browsers.
  await page.route("**/tile.openstreetmap.org/**", route => route.abort());
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/route-map") {
      lookups++;
      expect(route.request().postDataJSON().stops).toEqual([{ title: "Garden", location: "City Garden" }]);
      return route.fulfill({ json: !recover ? { stops: [], status: "provider_error", unresolved: 1 } : { stops: [{ index: 0, title: "Garden", location: "City Garden", coordinates: { lat: 38.72, lng: -9.15 }, source_id: "garden", source_url: "https://example.com/garden" }], status: "complete", unresolved: 0 } });
    }
    return route.fulfill({ json: path === "/api/auth/me" ? { user: { id: 701, name: "QA Traveler", status: "active" } } : path === "/api/trips" ? { trips: [trip] } : {} });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Open profile for QA Traveler" })).toBeVisible();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.getByRole("button", { name: "Open saved trips", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("tab", { name: "Itinerary", exact: true }).click();
  const panel = page.locator(".route-map-shell");
  await expect(panel.getByRole("button", { name: "Show Museum on map" })).toBeVisible();
  await expect(panel.getByText("Place search is temporarily unavailable. Try again.")).toBeVisible();
  recover = true;
  await panel.getByRole("button", { name: "Retry places" }).click();
  await expect(panel.getByRole("button", { name: "Show Garden on map" })).toBeVisible();
  await panel.getByRole("button", { name: "Show Garden on map" }).click();
  await expect(panel.locator(".route-number-marker")).toHaveCount(2);
  await accessible(page, ".route-map-shell");
  await panel.screenshot({ path: info.outputPath("light-route.png") });
  expect(lookups).toBeGreaterThanOrEqual(2);
});
