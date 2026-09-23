import type { OfflineTripPack } from "../../domain/travel";

const DB = "wanderful-offline-v2";
const ACCOUNT = "wanderful.offline-account";
const GENERATION = "wanderful.offline-generation";
type StoredPack = { key: string; owner: string; generation: string; pack: OfflineTripPack };
export const offlineGeneration = () => localStorage.getItem(GENERATION) || "initial";
function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("packs", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("packs", mode);
    let result: T;
    const request = action(tx.objectStore("packs"));
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error("Offline storage failed.")); };
  });
}
export async function saveOfflinePack(pack: OfflineTripPack, generation: string) {
  if (!pack.owner_id || generation !== offlineGeneration()) throw new Error("Session changed. Prepare the trip again.");
  const owner = String(pack.owner_id);
  await transaction("readwrite", store => {
    if (generation !== offlineGeneration()) throw new Error("Session changed.");
    return store.put({ key: `${owner}:${pack.trip.id}`, owner, generation, pack } satisfies StoredPack);
  });
  if (generation !== offlineGeneration()) throw new Error("Session changed.");
  localStorage.setItem(ACCOUNT, owner);
}
export async function listOfflinePacks(): Promise<OfflineTripPack[]> {
  const owner = localStorage.getItem(ACCOUNT), generation = offlineGeneration();
  if (!owner) return [];
  const values = await transaction<StoredPack[]>("readonly", store => store.getAll());
  if (owner !== localStorage.getItem(ACCOUNT) || generation !== offlineGeneration()) return [];
  return values.filter(value => value.owner === owner && value.generation === generation).map(value => value.pack);
}
export async function removeOfflinePack(tripId: string) {
  const owner = localStorage.getItem(ACCOUNT);
  if (owner) await transaction("readwrite", store => store.delete(`${owner}:${tripId}`));
}
export function clearOfflinePacks() {
  // Invalidate synchronously, including across tabs, before asynchronous deletion.
  localStorage.removeItem(ACCOUNT);
  localStorage.setItem(GENERATION, crypto.randomUUID());
  return transaction("readwrite", store => store.clear());
}
