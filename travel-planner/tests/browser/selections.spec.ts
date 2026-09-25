import { expect, test } from "@playwright/test";
import { accessible } from "./accessibility";

const initial = {
  form: { origin: "LAX", destination: "Lisbon", start_date: "2027-05-01", end_date: "2027-05-04", budget: "3200", adults: "2", currency_code: "USD", interests: "food" },
  itinerary: "# Lisbon\nA private itinerary.",
  structuredItinerary: { days: [], locked_flight_id: "", locked_hotel_id: "" },
  options: { hotels: [{ id: "hotel-fixture", name: "Lisbon Garden", currency: "USD", estimated_total: 420, nightly_rate: "$140" }], flights: [{ id: "flight-original", total_price: 600, currency: "USD", departure_token: "outbound", snapshot_id: "outbound-snapshot", segments: [{ airline: "Demo Air", from: "LAX", to: "LIS", depart_at: "2027-05-01 09:00", arrive_at: "2027-05-02 08:00" }] }], flight_recovery: [], map_center: null },
  resultTab: "flights",
};

test("completed return selection survives switching tabs and reloading; logout clears private workspace", async ({ page }, testInfo) => {
  let signedIn = true;
  let saved: Record<string, unknown>[] = [];
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    let response: unknown = {};
    if (path === "/api/auth/me") response = { user: signedIn ? { id: 701, name: "QA Traveler", email: "qa@example.test", status: "active" } : null };
    else if (path === "/api/auth/logout") { signedIn = false; response = { ok: true }; }
    else if (path === "/api/trips") {
      if (route.request().method() === "POST") { saved = [{ ...route.request().postDataJSON(), id: "7011" }]; response = { trip: saved[0] }; }
      else response = { trips: saved };
    }
    else if (path === "/api/preferences") response = { preferences: {} };
    else if (path === "/api/trips/7011/selection") {
      saved[0] = { ...saved[0], selections: [{ ...route.request().postDataJSON(), kind: "flights" }], savedAt: "2026-09-22T12:00:00Z" };
      response = { trip: saved[0] };
    }
    else if (path === "/api/flight-return-options") response = { return_options: [{ id: "complete-offer", snapshot_id: "complete-snapshot", total_price: 680, currency: "USD", has_return_details: true, booking_token: "booking", segments: [...initial.options.flights[0].segments, { airline: "Demo Air", from: "LIS", to: "LAX", depart_at: "2027-05-04 09:00", arrive_at: "2027-05-04 17:00" }] }] };
    await route.fulfill({ json: response });
  });
  await page.addInitScript((trip) => {
    if (!sessionStorage.getItem("qa-seeded")) {
      localStorage.setItem("wanderful.currentTrip.v3:user-701", JSON.stringify(trip));
      sessionStorage.setItem("qa-seeded", "true");
    }
  }, initial);
  await page.goto("/");
  await page.getByRole("button", { name: "Choose flight", exact: true }).click();
  await page.getByRole("button", { name: "Select return flight", exact: true }).click();
  await page.getByRole("button", { name: "Choose this round trip", exact: true }).click();
  await expect(page.getByRole("button", { name: "Selected", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Stays" }).click();
  await page.getByRole("button", { name: "Choose stay", exact: true }).click();
  await page.getByRole("tab", { name: "Flights" }).click();
  await expect(page.getByRole("button", { name: "Selected", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Selected", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Selections & booking status", { exact: true }).click();
  const booking = page.getByRole("group", { name: "Round-trip flight", exact: true });
  await booking.getByRole("combobox", { name: "Status", exact: true }).selectOption("externally_booked");
  await booking.getByLabel("Booking reference (optional)").fill("TEST-BOOKING");
  await booking.getByRole("button", { name: "Save selection", exact: true }).click();
  await expect(booking.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("externally_booked");
  await expect.poll(() => (saved[0].selections as { status: string }[] | undefined)?.[0]?.status).toBe("externally_booked");
  expect(saved[0].budgetState).toBeUndefined();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("region", { name: "Trip overview", exact: true })).toContainText("USD 680");
  await page.getByRole("tab", { name: "Trip tools", exact: true }).click();
  await page.getByRole("checkbox", { name: "Enable decorative cursor", exact: true }).check();
  await page.getByRole("checkbox", { name: "Enable decorative cursor", exact: true }).uncheck();
  await page.getByRole("tab", { name: "Flights", exact: true }).click();
  await expect(page.getByRole("button", { name: "Selected", exact: true })).toBeVisible();
  expect((saved[0].structuredItinerary as { locked_flight_id: string }).locked_flight_id).toBe("complete-offer");
  expect((saved[0].structuredItinerary as { locked_hotel_id: string }).locked_hotel_id).toBe("hotel-fixture");
  const savedOptions = saved[0].options as { flights: { id: string; total_price: number }[]; hotels: { id: string; estimated_total: number }[] };
  expect(savedOptions.flights.find((offer) => offer.id === "complete-offer")?.total_price).toBe(680);
  expect(savedOptions.hotels.find((offer) => offer.id === "hotel-fixture")?.estimated_total).toBe(420);
  await page.locator(".results-workspace").screenshot({ path: `artifacts/ui-audit/selection-persistence-${testInfo.project.name}.png`, animations: "disabled" });
  await page.getByRole("button", { name: "Open profile for QA Traveler" }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.locator(".results-workspace")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".results-workspace")).toHaveCount(0);
});

test("empty stays keep controls and independently recover from a provider failure", async ({ page }, testInfo) => {
  let searches = 0;
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    let response: unknown = {};
    if (path === "/api/auth/me") response = { user: { id: 701, name: "QA Traveler", status: "active" } };
    if (path === "/api/search-sessions") { searches += 1; response = { id: `retry-${searches}` }; }
    if (path.startsWith("/api/search-sessions/")) response = searches === 1
      ? { id: "retry-1", kind: "hotels", status: "timeout", hotels: [] }
      : { id: "retry-2", kind: "hotels", status: "success", hotels: initial.options.hotels };
    await route.fulfill({ json: response });
  });
  await page.addInitScript((trip) => localStorage.setItem("wanderful.currentTrip.v3:user-701", JSON.stringify({ ...trip, resultTab: "hotels", options: { ...trip.options, hotels: [], provider_status: { hotels: "empty" } } })), initial);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh stays", exact: true }).click();
  await expect(page.getByText("The provider took too long.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh stays", exact: true }).click();
  await expect(page.getByRole("button", { name: "Choose stay", exact: true })).toBeVisible();
  await expect(page.locator(".hotel-option-card")).toContainText("Lisbon Garden");
  await expect(page.locator(".hotel-option-card")).toContainText("Full-stay estimate");
  await page.getByRole("button", { name: "Stay details", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Stay details: Lisbon Garden", exact: true })).toContainText("No room-level rates supplied.");
  await page.keyboard.press("Escape");
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(page.getByText("Map unavailable for these hotel results", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByRole("button", { name: "Choose stay", exact: true })).toBeVisible();
  }
  await page.locator("#trip-panel-hotels").screenshot({ path: `artifacts/ui-audit/stay-recovery-${testInfo.project.name}.png`, animations: "disabled" });
});

test("flight filters and three-offer comparison work without replacing a selection", async ({ page }, testInfo) => {
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    await route.fulfill({ json: new URL(route.request().url()).pathname === "/api/auth/me" ? { user: { id: 701, name: "QA Traveler", status: "active" } } : {} });
  });
  await page.addInitScript((trip) => {
    const flights = [600, 300, null, 450].map((price, index) => ({ ...trip.options.flights[0], id: `option-${index}`, total_price: price, total_duration_minutes: [300, 600, null, 420][index] }));
    localStorage.setItem("wanderful.currentTrip.v3:user-701", JSON.stringify({ ...trip, options: { ...trip.options, flights } }));
  }, initial);
  await page.goto("/");
  await expect(page.locator(".flight-option-card")).toHaveCount(4);
  await page.getByRole("combobox", { name: "Sort flights", exact: true }).selectOption("cheapest");
  await expect(page.locator(".flight-option-card").first()).toContainText("USD 300");
  await page.getByRole("spinbutton", { name: "Flight price target", exact: true }).fill("100");
  await expect(page.locator(".flight-option-card")).toHaveCount(4);
  await page.getByRole("checkbox", { name: "Only show prices within target", exact: true }).check();
  await expect(page.locator(".flight-option-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(page.locator(".flight-option-card")).toHaveCount(4);
  for (const index of [1, 2, 3]) await page.getByRole("checkbox", { name: `Compare option ${index}`, exact: true }).check();
  await expect(page.getByRole("checkbox", { name: "Compare option 4", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Compare flights (3/3)", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Compare flights", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("table")).toContainText("USD 300");
  await accessible(page, "dialog[open]");
  await dialog.screenshot({ path: `artifacts/ui-audit/flight-comparison-${testInfo.project.name}.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Compare flights (3/3)", exact: true })).toBeFocused();
});

test("cross-tab logout discards an in-flight offer recheck and device copies", async ({ page, context }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  await context.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/recheck")) {
      started();
      await held;
      await route.fulfill({ json: { id: "late-private-search", status: "queued" } }).catch(() => {});
      return;
    }
    await route.fulfill({ json: path === "/api/auth/me" ? { user: { id: 701, name: "QA Traveler", status: "active" } } : {} });
  });
  await page.addInitScript((trip) => {
    localStorage.setItem("wanderful.currentTrip.v3:user-701", JSON.stringify(trip));
    localStorage.setItem("wanderful:offline-pack:701", "private offline data");
  }, initial);
  await page.goto("/");
  await page.getByRole("button", { name: "Recheck", exact: true }).click();
  await requested;
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await otherTab.getByRole("button", { name: "Open profile for QA Traveler" }).click();
  await otherTab.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.locator(".results-workspace")).toHaveCount(0);
  release();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("wanderful.currentTrip.v3:user-") || key.startsWith("wanderful:offline-pack:")))).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("wanderful.currentTrip.v3:guest") || "{}").itinerary || "")).toBe("");
});
