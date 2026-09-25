import { expect, test } from "@playwright/test";
import { accessible } from "./accessibility";

function fixture() {
  const hotels = [{ id: "original", snapshot_id: "original-snapshot", name: "Garden Hotel", estimated_total: 400, currency: "USD" }, { id: "alternate", snapshot_id: "alternate-snapshot", name: "River Hotel", estimated_total: 600, currency: "USD" }];
  return { id: "901", revision: 1, name: "Lisbon", destination: "Lisbon", dateRange: "May", savedAt: "2026-09-23", form: { origin: "LAX", destination: "Lisbon", start_date: "2027-05-01", end_date: "2027-05-04", adults: "2", budget: "2000", currency_code: "USD", interests: "food" }, itinerary: "# Lisbon", structuredItinerary: { days: [], locked_hotel_id: "original" }, options: { hotels, flights: [], flight_recovery: [], map_center: null }, resultTab: "hotels" };
}

test("review a more expensive stay before applying the selection", async ({ page }, info) => {
  let trip = fixture();
  let applied = false;
  await page.route((url) => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === "/api/auth/me") json = { user: { id: 701, name: "QA Traveler", status: "active" } };
    if (path === "/api/trips") json = { trips: [trip] };
    if (path.endsWith("/decisions/preview")) {
      expect(route.request().postDataJSON().expected_revision).toBe(1);
      json = { preview_token: "fixture-preview", impact: { currency: "USD", expected_revision: 1, price_delta_minor: 20000, can_apply: true, affected_activities: [], warnings: [], activity_windows: {}, assumptions: { arrival_buffer_minutes: 120, departure_buffer_minutes: 180, destination_timezone: "Europe/Lisbon" }, budget_after: { exponent: 2, budget_remaining_minor: 140000 } } };
    }
    if (path.endsWith("/decisions/apply")) { applied = true; trip = { ...trip, revision: 2, structuredItinerary: { ...trip.structuredItinerary, locked_hotel_id: "alternate" } }; json = { trip }; }
    await route.fulfill({ json });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open saved trips", exact: true }).click();
  await page.getByText("Selections & booking status", { exact: true }).click();
  const stay = page.getByRole("group", { name: "Stay", exact: true });
  await stay.getByRole("combobox", { name: "Option", exact: true }).selectOption("alternate-snapshot");
  await stay.getByRole("button", { name: "Save selection", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review trip impact", exact: true });
  await expect(dialog).toContainText("+$200.00");
  await expect(dialog).toContainText("$1,400.00");
  await accessible(page, "dialog[open]");
  expect(applied).toBe(false);
  await dialog.screenshot({ path: `test-results/decision-${info.project.name}.png`, animations: "disabled" });
  await dialog.getByRole("button", { name: "Apply reviewed choice" }).click();
  await expect(dialog).toHaveCount(0);
  expect(applied).toBe(true);
});

test("record a linked payment without duplicating the booking cost", async ({ page }, info) => {
  let trip = fixture();
  let ledger = { currency: "USD", exponent: 2, revision: 1, planned_minor: 60000, confirmed_minor: 60000, paid_minor: 0, remaining_expected_minor: 60000, budget_remaining_minor: 140000, records: [{ id: "owner-member", kind: "member", name: "Me" }] as Record<string, unknown>[], commitments: [{ id: "booking-hotels", kind: "commitment", label: "User-recorded hotels", amount_minor: 60000 }], balances: { "owner-member": 0 }, warnings: [] };
  await page.route((url) => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === "/api/auth/me") json = { user: { id: 701, name: "QA Traveler", status: "active" } };
    if (path === "/api/trips") json = { trips: [trip] };
    if (path.endsWith("/ledger")) json = { ledger };
    if (path.endsWith("/records")) {
      const body = route.request().postDataJSON();
      expect(body.commitment_id).toBe("booking-hotels");
      expect(body.amount).toBe("200.00");
      expect(body.expected_revision).toBe(1);
      trip = { ...trip, revision: 2 };
      ledger = { ...ledger, revision: 2, paid_minor: 20000, remaining_expected_minor: 40000, records: [...ledger.records, { ...body, amount_minor: 20000 }] };
      json = { trip, ledger };
    }
    await route.fulfill({ json });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open saved trips", exact: true }).click();
  await page.getByRole("button", { name: "Expenses", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Group expenses: Lisbon", exact: true });
  await dialog.getByRole("textbox", { name: "Payment description" }).fill("Hotel deposit");
  await dialog.getByRole("textbox", { name: "Payment amount" }).fill("200.00");
  await dialog.getByRole("combobox", { name: "Payment commitment" }).selectOption("booking-hotels");
  await dialog.getByRole("button", { name: "Record payment", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Payment amount" })).toHaveValue("");
  await expect(dialog).toContainText("$1,400.00");
  await expect(dialog).toContainText("$400.00");
  await expect(dialog.getByText("Hotel deposit", { exact: true })).toBeVisible();
  await accessible(page, "dialog[open]");
  await dialog.screenshot({ path: `test-results/ledger-${info.project.name}.png`, animations: "disabled" });
});
