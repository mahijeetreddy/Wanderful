import { expect, test } from "@playwright/test";
import { accessible } from "./accessibility";

test("journal and guidebook contain keyboard focus and expose accessible controls", async ({ page }, info) => {
  const trip = { id: "901", revision: 1, name: "Lisbon notes", destination: "Lisbon", savedAt: "2026-09-25", dateRange: "October", itinerary: "Plan", form: { currency_code: "USD" }, options: { hotels: [], flights: [] }, structuredItinerary: { days: [] } };
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ json: path === "/api/auth/me" ? { user: { id: 701, name: "QA Traveler", status: "active" } } : path === "/api/trips" ? { trips: [trip] } : path.endsWith("/journal") ? { entries: [] } : { guidebook: null } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open saved trips", exact: true }).click();
  for (const [button, title] of [["Journal", "Travel journal"], ["Guidebook", "Destination guidebook"], ["Document vault", "Travel document vault"]]) {
    const opener = page.getByRole("button", { name: button, exact: true });
    await opener.press("Enter");
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    if (button === "Journal") await expect(dialog.getByText("No entries yet.", { exact: false })).toBeVisible();
    await accessible(page, "dialog[open]");
    await dialog.getByRole("button", { name: button === "Document vault" ? "Close travel document vault" : "Close", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await dialog.screenshot({ path: `test-results/${button.toLowerCase()}-${info.project.name}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
});
