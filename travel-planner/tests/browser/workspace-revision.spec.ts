import { expect, test } from "@playwright/test";

test("reopened workspace updates the same trip and retains a stale draft", async ({ page }) => {
  let saved = { id: "901", revision: 1, name: "Lisbon", destination: "Lisbon", dateRange: "May", savedAt: "2026-09-23", form: { origin: "LAX", destination: "Lisbon", start_date: "2027-05-01", end_date: "2027-05-04", adults: "2", budget: "3200", currency_code: "USD", interests: "food" }, itinerary: "# Lisbon", structuredItinerary: { days: [] }, options: { hotels: [], flights: [], flight_recovery: [], map_center: null }, resultTab: "overview" };
  const methods: string[] = [];
  const revisions: number[] = [];
  let conflict = false;
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/trips/901" && route.request().method() === "PUT") {
      methods.push("PUT");
      const body = route.request().postDataJSON();
      revisions.push(body.expected_revision);
      if (conflict) { await route.fulfill({ status: 409, json: { error: "This trip changed elsewhere. Your draft is retained.", code: "revision_conflict" } }); return; }
      saved = { ...body, id: "901", revision: saved.revision + 1 };
      await route.fulfill({ json: { trip: saved } }); return;
    }
    if (path === "/api/trips" && route.request().method() === "POST") methods.push("POST");
    await route.fulfill({ json: path === "/api/auth/me" ? { user: { id: 701, name: "QA Traveler", status: "active" } } : path === "/api/trips" ? { trips: [saved] } : {} });
  });
  await page.addInitScript((trip) => {
    if (sessionStorage.getItem("revision-seeded")) return;
    sessionStorage.setItem("revision-seeded", "true");
    localStorage.setItem("wanderful.currentTrip.v3:user-701", JSON.stringify({ ...trip, activeSavedTrip: { id: trip.id, revision: trip.revision } }));
  }, saved);
  await page.goto("/");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  conflict = true;
  await page.getByRole("textbox", { name: "Destination", exact: true }).fill("My unsaved draft");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("This trip changed elsewhere. Your draft is retained.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Destination", exact: true })).toHaveValue("My unsaved draft");
  expect(methods).toEqual(["PUT", "PUT", "PUT"]);
  expect(revisions).toEqual([1, 2, 3]);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Destination", exact: true })).toHaveValue("My unsaved draft");
});
