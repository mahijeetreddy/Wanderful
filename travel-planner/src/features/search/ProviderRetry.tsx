import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, readApiJson } from "../../api/client";
import { sessionEpoch } from "../auth/session";
import type { PlannerForm, ProviderStatus, SearchSession } from "../../domain/travel";

export function ProviderRetry({ form, kind, status, onResults }: {
  form: PlannerForm; kind: "flights" | "hotels"; status?: ProviderStatus; onResults: (result: SearchSession) => void;
}) {
  const [search, setSearch] = useState<{ id: string; started: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const delivered = useRef("");
  const query = useQuery({
    queryKey: ["provider-retry", sessionEpoch(), search?.id], enabled: Boolean(search),
    queryFn: async ({ signal }): Promise<SearchSession> => {
      if (!search || Date.now() - search.started > 120_000) throw new Error("Search took too long. Please retry.");
      return readApiJson(await apiFetch(`/api/search-sessions/${search.id}`, { signal }));
    },
    refetchInterval: (query) => query.state.error || (query.state.data && !["queued", "searching"].includes(query.state.data.status)) ? false : 1500,
  });
  useEffect(() => {
    if (query.data?.status === "success" && delivered.current !== query.data.id) {
      delivered.current = query.data.id;
      onResults(query.data);
    }
  }, [query.data, onResults]);
  const state = query.data?.status || status;
  const busy = starting || Boolean(search && !query.error && (!query.data || ["queued", "searching"].includes(query.data.status)));
  const retry = async () => {
    setStarting(true); setError(""); setSearch(null);
    try {
      const result = await readApiJson<{ id: string }>(await apiFetch("/api/search-sessions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, kind }),
      }));
      setSearch({ id: result.id, started: Date.now() });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not start search."); }
    finally { setStarting(false); }
  };
  const labels: Partial<Record<ProviderStatus, string>> = {
    empty: "No matching options. Try other dates or a broader destination.",
    error: "The provider could not complete this search.", timeout: "The provider took too long.",
    unavailable: "This search is currently unavailable.", queued: "Waiting for options…", searching: "Searching…",
  };
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#72d7dc]/20 bg-[#72d7dc]/5 p-3">
    <p role="status" className="text-sm text-white/75">{error || query.error?.message || (busy ? "Searching…" : state && labels[state]) || "Options can change before booking."}</p>
    <button type="button" onClick={retry} disabled={busy} className="min-h-11 rounded-full border border-[#72d7dc]/30 px-4 text-sm text-[#a9f1f1] disabled:opacity-50">{busy ? "Searching…" : `Refresh ${kind === "hotels" ? "stays" : "flights"}`}</button>
  </div>;
}
