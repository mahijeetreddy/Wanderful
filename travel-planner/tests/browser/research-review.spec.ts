import { expect, test } from "@playwright/test";
import { accessible } from "./accessibility";

test("late place research requires review and explicit application", async ({ page }) => {
  const day = { day_number: 1, date: "2027-05-01", title: "Ancient Rome", activities: [{ title: "Visit Roman Forum", location: "Roman Forum", time: "10:00" }] };
  const trip = { form: { origin: "LAX", destination: "Rome", start_date: "2027-05-01", end_date: "2027-05-02", budget: "3000", adults: "1", currency_code: "USD", interests: "history" }, itinerary: "# Rome\nA draft itinerary.", structuredItinerary: { days: [day] }, activePlanJobId: "evidence-job", options: { flights: [], hotels: [], flight_recovery: [], map_center: null }, resultTab: "overview" };
  let polls = 0;
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === "/api/auth/me") json = { user: { id: 701, name: "QA Traveler", status: "active" } };
    else if (path === "/api/trips") json = { trips: [] };
    else if (path.endsWith("/research")) json = ++polls === 1 ? { research: { status: "pending" }, checks: [] } : { research: { status: "success", retrieved_at: "2026-09-30T12:00:00Z" }, checks: [{ date: day.date, activity_index: 0, activity_title: day.activities[0].title, activity_location: "Roman Forum", status: "place_identity_matched", place: { title: "Roman Forum", address: "Rome, Italy", coordinates: { lat: 41.89, lng: 12.48 }, source_id: "verified-fixture", source_url: "https://www.google.com/maps/search/?api=1&query=Roman+Forum" } }] };
    await route.fulfill({ json });
  });
  await page.addInitScript(trip => localStorage.setItem("wanderful.currentTrip.v3:user-701", JSON.stringify(trip)), trip);
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Place research" });
  await expect(panel).toContainText("Place checks available", { timeout: 15000 });
  await expect(panel).toContainText("remain unverified");
  const current = () => page.evaluate(() => JSON.parse(localStorage.getItem("wanderful.currentTrip.v3:user-701") || "{}").structuredItinerary.days[0].activities[0]);
  expect((await current()).coordinates).toBeUndefined();
  await panel.getByRole("button", { name: "Review place checks (1)" }).click();
  await accessible(page, ".draft-preview");
  await expect(panel.getByRole("link", { name: "Roman Forum · Rome, Italy" })).toBeVisible();
  expect((await current()).coordinates).toBeUndefined();
  await panel.getByRole("button", { name: "Apply reviewed map references" }).click();
  await expect.poll(async () => (await current()).source_id).toBe("verified-fixture");
  expect((await current()).time).toBe("10:00");
  expect((await current()).title).toBe("Visit Roman Forum");
});
