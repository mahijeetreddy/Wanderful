import { expect, test } from "@playwright/test";
import { accessible } from "./accessibility";

test("stay map separates viewing from choosing and dialogs recover with keyboard", async ({ page }, testInfo) => {
  const hotels = [
    { id: "garden", snapshot_id: "garden-snapshot", name: "Garden Hotel", estimated_total: 420, currency: "USD", coordinates: { lat: 38.72, lng: -9.14 }, image_thumbnail: "/broken-hotel.jpg" },
    { id: "river", name: "River Hotel", estimated_total: 500, currency: "USD", coordinates: { lat: 38.71, lng: -9.13 } },
    { id: "unknown", name: "Unlocated Hotel", coordinates: { lat: 999, lng: -9.14 } },
  ];
  let providerAvailable = false;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/broken-hotel.jpg", (route) => route.fulfill({ status: 404, body: "" }));
  // No real map tile or provider requests in this fixture journey.
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/property-details")) {
      await route.fulfill(!providerAvailable
        ? { status: 503, json: { message: "Property provider unavailable" } }
        : { json: { status: "success", address: "Fixture address", amenities: ["Garden"], rates: [] } });
      return;
    }
    await route.fulfill({ json: path === "/api/auth/me" ? { user: { id: 701, name: "QA Traveler", status: "active" } } : {} });
  });
  await page.addInitScript((hotels) => {
    localStorage.setItem("wanderful.currentTrip.v3:user-701", JSON.stringify({
      form: { origin: "LAX", destination: "Lisbon", start_date: "2027-05-01", end_date: "2027-05-04", adults: "2", currency_code: "USD", budget: "3200", interests: "food" },
      itinerary: "# Lisbon", structuredItinerary: { days: [] }, options: { hotels, flights: [], flight_recovery: [], map_center: null }, resultTab: "hotels",
    }));
  }, hotels);
  await page.goto("/");
  const garden = page.getByRole("article", { name: "Garden Hotel", exact: true });
  const unknown = page.getByRole("article", { name: "Unlocated Hotel", exact: true });
  await garden.scrollIntoViewIfNeeded();
  await expect(garden.getByText("Photo unavailable", { exact: true })).toBeVisible();
  await expect(unknown.getByRole("button", { name: "Show on map" })).toHaveCount(0);
  await garden.getByRole("button", { name: "Show on map" }).press("Enter");
  const map = page.getByRole("region", { name: "Stay map", exact: true });
  await expect(map).toBeVisible();
  await expect(map.getByText("Viewing stay", { exact: true })).toBeVisible();
  await expect(map.locator(".leaflet-marker-icon")).toHaveCount(2);
  await map.getByRole("button", { name: "View River Hotel on map", exact: true }).press("Enter");
  await map.getByRole("button", { name: "Choose this stay", exact: true }).press("Enter");
  await expect(map.getByText("Selected stay", { exact: true })).toBeVisible();
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "List", exact: true }).press("Enter");
  await expect(page.getByRole("article", { name: "River Hotel", exact: true }).getByRole("button", { name: "Selected", exact: true })).toHaveAttribute("aria-pressed", "true");
  const opener = garden.getByRole("button", { name: "Stay details", exact: true });
  await opener.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Stay details: Garden Hotel", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("Property provider unavailable", { timeout: 20000 });
  providerAvailable = true;
  await dialog.getByRole("button", { name: "Retry details" }).press("Enter");
  await expect(dialog.getByText("Fixture address", { exact: true })).toBeVisible();
  await accessible(page, "dialog[open]");
  const close = dialog.getByRole("button", { name: "Close details" });
  await close.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  await dialog.screenshot({ path: `test-results/stay-keyboard-${testInfo.project.name}.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(errors).toEqual([]);
});
