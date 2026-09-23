import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../api/client";
import { sessionEpoch } from "../auth/session";
import type { FlightOffer, HotelOffer, SearchSession } from "../../domain/travel";

const labels = {
  success: "Search completed. Your selection is unchanged; use Search to compare current options.",
  empty: "No options found. Your saved selection is still here.",
  unavailable: "Search is unavailable. Try again later.",
  timeout: "The provider took too long. You can retry.",
  error: "Could not recheck. You can retry.",
  queued: "Rechecking availability…",
  searching: "Rechecking availability…",
};

export function OfferFreshness({ offer }: { offer: FlightOffer | HotelOffer }) {
  const [searchId, setSearchId] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const stale = !offer.stale_after || !Number.isFinite(Date.parse(offer.stale_after)) || Date.parse(offer.stale_after) <= Date.now();
  const query = useQuery({
    queryKey: ["offer-recheck", sessionEpoch(), searchId],
    enabled: Boolean(searchId),
    queryFn: async ({ signal }): Promise<SearchSession> => {
      const response = await apiFetch(`/api/search-sessions/${encodeURIComponent(searchId)}`, { signal });
      if (!response.ok) throw new Error("Could not check availability. Please retry.");
      return response.json();
    },
    refetchInterval: (state) => state.state.error || (state.state.data && !["queued", "searching"].includes(state.state.data.status)) ? false : 1500,
  });
  const busy = starting || Boolean(searchId && !query.isError && (!query.data || ["queued", "searching"].includes(query.data.status)));
  const recheck = async () => {
    setStarting(true);
    setError("");
    setSearchId("");
    try {
      const response = await apiFetch(`/api/offers/${encodeURIComponent(offer.snapshot_id!)}/recheck`, { method: "POST" });
      if (!response.ok) throw new Error("Could not start recheck. Please try again.");
      const result = await response.json();
      setSearchId(result.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Recheck failed."); }
    finally { setStarting(false); }
  };
  return <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/65" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <span>{stale ? "Saved price · recheck before booking" : "Price snapshot · availability can change"}</span>
    {offer.snapshot_id ? <button type="button" disabled={busy} onClick={recheck} className="min-h-11 rounded-full border border-amber-200/25 px-3 text-amber-100 hover:bg-amber-100/10 disabled:opacity-50">{busy ? "Checking…" : "Recheck"}</button> : <span>Run a new search to refresh this historical option.</span>}
    <span role="status" className="basis-full">{error || query.error?.message || (query.data ? labels[query.data.status] : "")}</span>
  </div>;
}
