import { expect, test } from "@playwright/test";

test("selected room rate survives refresh, reload, saving and reopening", async ({ page }, testInfo) => {
  const form = { origin: "LAX", destination: "Lisbon", start_date: "2027-05-01", end_date: "2027-05-04", budget: "3200", adults: "2", currency_code: "USD", interests: "food" };
  const hotel = { id: "property", snapshot_id: "property-snapshot", name: "Lisbon Garden", estimated_total: 400, currency: "USD" };
  const rate = { ...hotel, id: "garden-suite", snapshot_id: "rate-snapshot", property_id: "property", room_type: "Garden suite", rate_source: "Example Provider", estimated_total: 510.25, price_amount: "510.25", price_basis: "provider_stay_total" };
  let saved: Record<string, unknown> | null = null;
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    let response: unknown = {};
    if (path === "/api/auth/me") response = { user: { id: 701, name: "QA Traveler", status: "active" } };
    if (path === "/api/offers/property-snapshot/property-details") response = { status: "success", rates: [{ source: "Example Provider", room_type: "Garden suite", full_stay_price: "$510.25", inclusions: ["Breakfast"], offer: rate }, { source: "Other Provider", room_type: "Unknown total", inclusions: [] }] };
    if (path === "/api/search-sessions") response = { id: "refresh" };
    if (path === "/api/search-sessions/refresh") response = { id: "refresh", status: "success", kind: "hotels", hotels: [{ ...rate, snapshot_id: "changed-snapshot", estimated_total: 600, price_amount: "600" }] };
    if (path === "/api/trips") {
      if (route.request().method() === "POST") { saved = { ...route.request().postDataJSON(), id: "trip-1" }; response = { trip: saved }; }
      else response = { trips: saved ? [saved] : [] };
    }
    await route.fulfill({ json: response });
  });
  await page.addInitScript(({ form, hotel }) => {
    if (sessionStorage.getItem("seeded-rate")) return;
    sessionStorage.setItem("seeded-rate", "true");
    localStorage.setItem("wanderful.currentTrip.v3:user-701", JSON.stringify({ form, itinerary: "# Lisbon", structuredItinerary: { days: [] }, options: { hotels: [hotel], flights: [], flight_recovery: [], map_center: null }, resultTab: "hotels" }));
  }, { form, hotel });
  await page.goto("/");
  await page.getByRole("button", { name: "Stay details", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Stay details: Lisbon Garden", exact: true });
  await expect(details.getByRole("button", { name: "Choose this rate", exact: true })).toHaveCount(1);
  await details.getByRole("button", { name: "Choose this rate", exact: true }).click();
  const selected = page.locator(".hotel-option-card").filter({ has: page.getByRole("button", { name: "Selected", exact: true }) });
  await expect(selected).toContainText("Garden suite");
  await expect(selected).toContainText("USD 510.25");
  await page.getByRole("button", { name: "Refresh stays", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh stays", exact: true })).toBeEnabled();
  await expect(selected).toContainText("USD 510.25");
  await page.reload();
  await expect(selected).toContainText("USD 510.25");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(selected).toContainText("Garden suite");
  await expect(selected).toContainText("USD 510.25");
  await selected.screenshot({ path: `artifacts/ui-audit/selected-room-rate-${testInfo.project.name}.png`, animations: "disabled" });
});
