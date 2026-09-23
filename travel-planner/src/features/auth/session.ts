import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } });
let epoch = 0;
const requests = new Set<AbortController>();
export const sessionEpoch = () => epoch;
export function registerRequest(controller: AbortController) {
  requests.add(controller);
  return () => requests.delete(controller);
}
export function invalidateSession(broadcast = false) {
  epoch += 1;
  for (const controller of requests) controller.abort();
  requests.clear();
  queryClient.clear();
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("wanderful.currentTrip") || key.startsWith("wanderful:offline-pack:") || key === "wanderful.savedTrips.v1") localStorage.removeItem(key);
  }
  if (broadcast) localStorage.setItem("wanderful.session-ended", crypto.randomUUID());
}

export function observeSessionEnd(onEnd: () => void) {
  const listener = (event: StorageEvent) => {
    if (event.key === "wanderful.session-ended") { invalidateSession(); onEnd(); }
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
