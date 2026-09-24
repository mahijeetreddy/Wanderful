import { apiFetch } from "../../api/client";
export function recordHandoff(snapshotId?: string) {
  if (snapshotId) void apiFetch(`/api/offers/${encodeURIComponent(snapshotId)}/handoff`, { method: "POST", keepalive: true }).then(response => response.text()).catch(() => undefined);
}
