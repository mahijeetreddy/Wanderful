import { expect, test } from "@playwright/test";
import { accessible } from "./accessibility";
test("itinerary restore is explicit and retains the choice on revision conflict", async ({ page }, info) => {
  const trip = { id: "901", revision: 3, name: "History trip", destination: "Lisbon", savedAt: "2026-09-24", dateRange: "September", itinerary: "Current", form: { currency_code: "USD" }, options: { hotels: [], flights: [] }, structuredItinerary: { days: [] } };
  let attempts = 0;
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/undo")) {
      expect(route.request().postDataJSON()).toEqual({ expected_revision: 3, target_revision: 1 });
      attempts++;
      await route.fulfill({ status: 409, json: { error: "Trip changed elsewhere. Your current trip is unchanged." } }); return;
    }
    await route.fulfill({ json: path === "/api/auth/me" ? { user: { id: 701, name: "History QA", status: "active" } } : path === "/api/trips" ? { trips: [trip] } : path.endsWith("/history") ? { revision: 3, history: [{ revision: 1, created_at: "2026-09-23T12:00:00Z", days: 3 }] } : {} });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open saved trips", exact: true }).click();
  const opener = page.getByRole("button", { name: "Itinerary history", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Itinerary history", exact: true });
  await expect(dialog).toContainText("Payments, settlements, documents, and booking status stay unchanged.");
  await dialog.getByRole("radio").check();
  expect(attempts).toBe(0);
  await dialog.getByRole("button", { name: "Restore selected revision" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Trip changed elsewhere");
  await expect(dialog.getByRole("radio")).toBeChecked();
  await accessible(page, "dialog[open]");
  await dialog.screenshot({ path: `test-results/history-${info.project.name}.png` });
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});
