import { expect, test } from "@playwright/test";
import { accessible } from "./accessibility";

for (const finish of ["complete", "logout"] as const) {
  test(`streamed draft is read-only and cleared on ${finish}`, async ({ page }) => {
    let signedIn = true;
    let complete = false;
    const day = { day_number: 1, date: "2027-05-01", title: "Riverside afternoon", activities: [{ title: "Visit the museum", time: "14:00" }] };
    const options = { flights: [], hotels: [], flight_recovery: [], map_center: null };
    await page.route(url => url.pathname.startsWith("/api/"), async route => {
      const path = new URL(route.request().url()).pathname;
      let json: unknown = {};
      if (path === "/api/auth/me") json = { user: signedIn ? { id: 701, name: "QA Traveler", status: "active" } : null };
      else if (path === "/api/trips") json = { trips: [] };
      else if (path === "/api/preferences") json = { preferences: {} };
      else if (path === "/api/auth/logout") { signedIn = false; json = { ok: true }; }
      else if (path === "/api/plan-jobs" && route.request().method() === "POST") json = { job_id: "draft-fixture" };
      else if (path === "/api/plan-jobs/draft-fixture") json = { job: { id: "draft-fixture", status: complete ? "complete" : "planning", progress: "Drafting your trip", options, metrics: { draft_days: [day] }, ...(complete ? { itinerary: "# Lisbon\nCompleted trip.", structured_itinerary: { days: [day] } } : {}) } };
      await route.fulfill({ json });
    });
    await page.addInitScript(options => {
      localStorage.setItem("wanderful.currentTrip.v3:user-701", JSON.stringify({ form: { origin: "LAX", destination: "Lisbon", start_date: "2027-05-01", end_date: "2027-05-02", budget: "3000", adults: "1", currency_code: "USD", interests: "history" }, options, itinerary: "", resultTab: "itinerary" }));
    }, options);
    await page.goto("/");
    await page.getByRole("button", { name: "Build my trip", exact: true }).click();
    const preview = page.getByRole("region", { name: "Itinerary draft preview" });
    await expect(preview).toContainText("Visit the museum");
    await expect(page.getByRole("button", { name: "PDF", exact: true })).toHaveCount(0);
    await accessible(page, ".draft-preview");
    if (finish === "complete") {
      complete = true;
      await expect(preview).toHaveCount(0);
      await expect(page.getByRole("button", { name: "PDF", exact: true })).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Open profile for QA Traveler" }).click();
      await page.getByRole("button", { name: "Log out", exact: true }).click();
      await expect(preview).toHaveCount(0);
      await expect(page.getByText("Visit the museum", { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.includes("user-701")))).toBe(false);
    }
  });
}
