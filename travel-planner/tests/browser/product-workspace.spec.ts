import { expect, test, type Page } from "@playwright/test";
import { accessible } from "./accessibility";
import { localDay, startMinutes } from "../../src/features/workspace/TodayMode";
import type { SavedTrip } from "../../src/domain/travel";
import type { ToolRecord } from "../../src/features/workspace/types";

const initial: SavedTrip = { id: "901", revision: 1, name: "Lisbon escape", destination: "Lisbon", savedAt: "2026-09-27", dateRange: "May 1–4", itinerary: "Your Lisbon plan", form: { origin: "LAX", destination: "Lisbon", start_date: "2027-05-01", end_date: "2027-05-04", budget: "2500", currency_code: "USD", adults: "2", interests: "Art", destination_timezone: "Europe/Lisbon" }, options: { flights: [], hotels: [], map_center: null, flight_recovery: [] }, structuredItinerary: { days: [{ day_number: 1, date: "2027-05-01", title: "Old town, new discoveries", estimated_cost: 60, activities: [{ title: "Explore Alfama", time: "10:00", location: "Alfama" }, { title: "Lunch by the river", time: "13:00", location: "Cais do Sodre" }] }] } };

async function setup(page: Page, conflict = false) {
  let trip = structuredClone(initial);
  const records: ToolRecord[] = [];
  let preferences = { pace: "balanced", walking: "moderate", flight_time: "any", stay_priority: "location", interests: "" }, prefRevision = 0;
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method();
    expect(path, "Trip tools must not start planning jobs").not.toBe("/api/plan-jobs");
    if (path === "/api/travel-preferences") {
      if (method === "PUT") { const body = route.request().postDataJSON(); expect(body.expected_revision).toBe(prefRevision); preferences = body.preferences; prefRevision++; }
      return route.fulfill({ json: { preferences, revision: prefRevision } });
    }
    if (path.endsWith("/booking-inbox/extract")) return route.fulfill({ json: { draft: { title: "Riverside Hotel", kind: "stay", reference: "ABC123", start_date: "2027-05-01", end_date: "2027-05-04", time: "15:00", address: "River square" }, notice: "Review all fields. Nothing has been saved." } });
    if (path.endsWith("/travel-tools")) {
      if (method === "POST") {
        if (conflict) return route.fulfill({ status: 409, json: { error: "Trip changed elsewhere. Your draft is retained." } });
        const body = route.request().postDataJSON(); expect(body.expected_revision).toBe(trip.revision);
        const record: ToolRecord = body.type === "inbox" ? { id: body.id, type: "inbox", data: body.data } : { id: body.id, type: "scenario", data: { name: body.data.name, base_revision: trip.revision!, form: { ...trip.form, start_date: body.data.start_date, end_date: body.data.end_date }, currency: "USD", exponent: 2, travel_total_minor: null, baseline_travel_total_minor: null, delta_minor: null, available_hours: null, warnings: ["Dates changed: new quotes required."], activity_windows: {}, selected: {}, impacts: [] } };
        records.push(record); trip = { ...trip, revision: trip.revision! + 1 };
        return route.fulfill({ json: { trip, record } });
      }
      return route.fulfill({ json: { records, revision: trip.revision } });
    }
    await route.fulfill({ json: path === "/api/auth/me" ? { user: { id: 701, name: "Product QA", status: "active" } } : path === "/api/trips" ? { trips: [trip] } : {} });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open saved trips", exact: true }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  return records;
}

test("preferences save independently and comparison survives reopening", async ({ page }, info) => {
  await setup(page);
  await page.getByRole("button", { name: "Travel preferences", exact: true }).click();
  const preferences = page.getByRole("dialog", { name: "Personal travel preferences" });
  await preferences.getByRole("radio", { name: "relaxed", exact: true }).check();
  await preferences.getByLabel("Interests & personal priorities").fill("Architecture and quiet mornings");
  await accessible(page, "dialog[open]");
  await preferences.screenshot({ path: `test-results/preferences-${info.project.name}.png` });
  await preferences.getByRole("button", { name: "Save preferences" }).click();
  await page.getByRole("button", { name: "Travel preferences", exact: true }).click();
  await expect(preferences.getByRole("radio", { name: "relaxed", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "What if?", exact: true }).click();
  const comparison = page.getByRole("dialog", { name: "What if trip comparison" });
  await comparison.getByLabel("Alternative name").fill("A week later");
  await comparison.getByLabel("Departure date", { exact: true }).fill("2027-05-08");
  await comparison.getByLabel("Return date", { exact: true }).fill("2027-05-11");
  await comparison.getByRole("button", { name: "Add to comparison" }).click();
  await expect(comparison.getByRole("heading", { name: "A week later" })).toBeVisible();
  await accessible(page, "dialog[open]");
  await comparison.screenshot({ path: `test-results/comparison-${info.project.name}.png` });
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "What if?", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A week later" })).toBeVisible();
});

test("booking import requires review and feeds Today mode", async ({ page }, info) => {
  const records = await setup(page);
  await page.getByRole("button", { name: "Booking inbox", exact: true }).click();
  const inbox = page.getByRole("dialog", { name: "Booking inbox", exact: true });
  await inbox.getByRole("button", { name: "Add booking", exact: true }).click();
  await inbox.getByText("Import a confirmation", { exact: true }).click();
  await inbox.getByLabel("Confirmation text", { exact: true }).fill("Hotel: Riverside Hotel\nReference: ABC123");
  await inbox.getByRole("button", { name: "Extract for review" }).click();
  await expect(inbox.getByLabel("Booking name")).toHaveValue("Riverside Hotel");
  expect(records).toHaveLength(0);
  await inbox.getByLabel("Status", { exact: true }).selectOption("confirmed");
  await inbox.getByRole("button", { name: "Save reviewed booking" }).click();
  await expect(inbox.getByRole("heading", { name: "Riverside Hotel" })).toBeVisible();
  await accessible(page, "dialog[open]");
  await inbox.screenshot({ path: `test-results/inbox-${info.project.name}.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Today mode", exact: true }).click();
  const today = page.getByRole("dialog", { name: "Today travel mode", exact: true });
  await expect(today.getByRole("heading", { name: "Bookings for this day" })).toBeVisible();
  await expect(today.getByText("ABC123", { exact: false })).toBeVisible();
  await expect(today.getByRole("link", { name: "Directions" })).toHaveCount(2);
  await today.getByLabel("Destination time zone", { exact: true }).fill("Invalid/Zone");
  await expect(today.getByRole("status")).toContainText("valid destination time zone");
  await today.getByLabel("Destination time zone", { exact: true }).fill("Europe/Lisbon");
  await accessible(page, "dialog[open]");
  await today.screenshot({ path: `test-results/today-${info.project.name}.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Today mode", exact: true })).toBeFocused();
});

test("inbox draft survives revision conflict", async ({ page }) => {
  await setup(page, true);
  await page.getByRole("button", { name: "Booking inbox", exact: true }).click();
  const inbox = page.getByRole("dialog", { name: "Booking inbox", exact: true });
  await inbox.getByRole("button", { name: "Add booking", exact: true }).click();
  await inbox.getByLabel("Booking name").fill("Keep this draft");
  await inbox.getByRole("button", { name: "Save reviewed booking" }).click();
  await expect(inbox.getByRole("alert")).toContainText("changed elsewhere");
  await expect(inbox.getByLabel("Booking name")).toHaveValue("Keep this draft");
});

test("Today uses destination calendar dates and rejects invalid times", () => {
  expect(localDay(new Date("2027-05-01T00:30:00Z"), "America/Los_Angeles")).toBe("2027-04-30");
  expect(localDay(new Date(), "Not/AZone")).toBeNull();
  expect(startMinutes("10:30–12:00")).toBe(630);
  expect(startMinutes("24:15")).toBeNull();
  expect(startMinutes("Morning")).toBeNull();
});

test("alternative search publishes stays during flight failure and completes return quotes", async ({ page }) => {
  await setup(page);
  let flightAttempt = 0;
  await page.route("**/api/search-sessions", async route => {
    const { kind } = route.request().postDataJSON();
    if (kind === "flights") flightAttempt++;
    await route.fulfill({ json: { id: kind, status: "queued" } });
  });
  await page.route("**/api/search-sessions/*", async route => {
    const kind = route.request().url().split("/").at(-1);
    await route.fulfill({ json: kind === "hotels" ? { status: "success", hotels: [{ id: "hotel", snapshot_id: "stay-quote", name: "Garden stay", currency: "USD", estimated_total: 300 }] } : flightAttempt === 1 ? { status: "error", flights: [] } : { status: "success", flights: [{ id: "outbound", snapshot_id: "outbound-quote", departure_token: "token", segments: [{ airline: "Test Air", depart_at: "2027-05-01 08:00" }] }] } });
  });
  await page.route("**/api/flight-return-options", async route => {
    expect(route.request().postDataJSON().snapshot_id).toBe("outbound-quote");
    await route.fulfill({ json: { return_options: [{ id: "complete", snapshot_id: "complete-quote", has_return_details: true, total_price: 400, currency: "USD", segments: [{ airline: "Test Air", depart_at: "2027-05-01 08:00" }] }] } });
  });
  await page.getByRole("button", { name: "What if?", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "What if trip comparison" });
  await dialog.getByRole("button", { name: "Search these dates" }).click();
  await expect(dialog.getByRole("status")).toContainText("Flights: error · Stays: success");
  await dialog.getByLabel("Stay", { exact: false }).selectOption("stay-quote");
  await dialog.getByRole("button", { name: "Search these dates" }).click();
  await dialog.getByLabel("Complete an outbound flight", { exact: false }).selectOption("outbound-quote");
  await dialog.getByRole("button", { name: "Find return choices" }).click();
  await dialog.getByLabel("Round-trip flight", { exact: false }).selectOption("complete-quote");
  await expect(dialog.getByLabel("Round-trip flight", { exact: false })).toHaveValue("complete-quote");
});
