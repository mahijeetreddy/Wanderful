import { expect, test } from "@playwright/test";

test("prepared trip survives a production offline reload; logout clears IndexedDB", async ({ page, context }, info) => {
  let privateRequests = 0;
  await context.route((url) => url.pathname.startsWith("/api/"), async route => {
    privateRequests++;
    await route.fulfill({ json: new URL(route.request().url()).pathname === "/api/auth/me" ? { user: { id: 701, name: "Offline QA", status: "active" } } : { trips: [] } });
  });
  await page.goto("http://127.0.0.1:5175/offline");
  await expect(page.getByRole("heading", { name: "Your trip, within reach." })).toBeVisible();
  expect(privateRequests).toBe(0);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    localStorage.setItem("wanderful.offline-account", "701");
    localStorage.setItem("wanderful.offline-generation", "fixture-generation");
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("wanderful-offline-v2", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("packs", { keyPath: "key" });
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("packs", "readwrite");
        const pack = { owner_id: 701, version: 2, trip: { id: "901", name: "Lisbon offline", destination: "Lisbon", date_range: "September" }, generated_at: "2026-09-23T12:00:00Z", days: [{ day_number: 1, title: "Explore", activities: [{ title: "Visit the museum", time: "10:00", location: "Museum square" }] }], essentials: { packing: [] } };
        tx.objectStore("packs").put({ key: "701:901", owner: "701", generation: "fixture-generation", pack });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Lisbon offline" })).toBeVisible();
  await expect(page.getByText("Visit the museum", { exact: true })).toBeVisible();
  expect(privateRequests).toBe(0);
  await page.screenshot({ path: `test-results/offline-${info.project.name}.png`, fullPage: true });
  await context.setOffline(false);
  const online = await context.newPage();
  await online.goto("http://127.0.0.1:5175/");
  await online.getByRole("button", { name: "Open profile for Offline QA" }).click();
  await online.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByText("No prepared trips on this device.", { exact: false })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => await new Promise<number>(resolve => {
    const request = indexedDB.open("wanderful-offline-v2", 1);
    request.onsuccess = () => { const db = request.result; const count = db.transaction("packs").objectStore("packs").count(); count.onsuccess = () => { db.close(); resolve(count.result); }; };
  }))).toBe(0);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).filter(key => key.startsWith("wanderful-shell-")).map(async key => (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)))).flat());
  expect(cached.some(path => path.startsWith("/api/") || path.includes("documents"))).toBe(false);
});
