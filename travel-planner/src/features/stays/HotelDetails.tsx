import { useQuery } from "@tanstack/react-query";
import type { HotelOption } from "../../domain/travel";
import { apiFetch } from "../../api/client";
import { sessionEpoch } from "../auth/session";
import { Modal } from "../search/Modal";

type PropertyDetails = { status: string; message?: string; description?: string; address?: string; check_in_time?: string; check_out_time?: string; amenities?: string[]; images?: string[]; rates?: { source?: string; room_type?: string; full_stay_price?: string; nightly_price?: string; before_taxes_fees?: string; inclusions: string[]; offer?: HotelOption; link?: string }[] };

export function HotelDetails({ hotel, onClose, onSelectRate }: { hotel: HotelOption; onClose: () => void; onSelectRate: (offer: HotelOption) => void }) {
  const query = useQuery({ queryKey: ["hotel-property", sessionEpoch(), hotel.snapshot_id], enabled: Boolean(hotel.snapshot_id),
    queryFn: async ({ signal }): Promise<PropertyDetails> => {
      const response = await apiFetch(`/api/offers/${hotel.snapshot_id}/property-details`, { signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not load property details.");
      return result;
    },
  });
  const details = query.data;
  return <Modal label={`Stay details: ${hotel.name}`} onClose={onClose}><section className="max-h-[90dvh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-amber-200/20 bg-[#0e1518] p-5 sm:p-7">
    <header className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-amber-100">Your possible home base</p><h2 className="mt-2 text-2xl text-white">{hotel.name}</h2><p className="mt-2 text-sm text-white/65">{details?.address}</p></div><button type="button" onClick={onClose} className="min-h-11 rounded-full border border-white/20 px-4">Close details</button></header>
    <p className="my-4 text-sm leading-relaxed text-white/70">{details?.description || hotel.description || "Property description not supplied."}</p>
    {query.isFetching ? <p role="status" className="my-4 text-sm text-[#a9f1f1]">Loading property details…</p> : null}
    {query.error ? <div role="alert" className="my-4 text-sm text-amber-100">{query.error.message}<button type="button" onClick={() => void query.refetch()} className="ml-3 min-h-11 rounded-full border border-amber-100/30 px-4">Retry details</button></div> : null}
    {!hotel.snapshot_id || (details && details.status !== "success") ? <p className="my-3 text-sm text-amber-100">{details?.message || "Refresh this historical stay to load current details."}</p> : null}
    {!!details?.images?.length && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{details.images.map((url, index) => <img key={url} src={url} alt={`${hotel.name}, property photo ${index + 1}`} loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} className="h-36 w-full rounded-2xl object-cover" />)}</div>}
    <div className="my-4 flex flex-wrap gap-2">{(details?.amenities || hotel.amenities || []).slice(0, 12).map((amenity) => <span key={amenity} className="rounded-full border border-[#72d7dc]/20 px-3 py-2 text-xs text-[#c3e5e5]">{amenity}</span>)}</div>
    <p className="text-sm text-white/65">Check-in: {details?.check_in_time || "Not supplied"} · Check-out: {details?.check_out_time || "Not supplied"}</p>
    <h3 className="mt-6 text-xl text-white">Provider rates</h3><p className="my-2 text-xs text-white/65">These are separate quotes, not changes to your saved selection. Confirm room, taxes and cancellation terms before booking.</p>
    {!details?.rates?.length ? <p className="my-4 text-sm text-white/60">No room-level rates supplied.</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2">{details.rates.map((rate, index) => <article key={index} className="rounded-2xl border border-amber-200/20 bg-amber-200/5 p-4"><p className="text-sm text-amber-100">{rate.source || "Provider"}</p><h4 className="mt-2 font-medium text-white">{rate.room_type || "Room not specified"}</h4><p className="mt-3 text-xl text-white">{rate.full_stay_price || "Full-stay total unavailable"}</p>{rate.full_stay_price ? <p className="text-xs text-white/60">Full-stay quote</p> : null}{rate.nightly_price ? <p className="mt-1 text-xs text-white/60">{rate.nightly_price} per night</p> : null}{rate.before_taxes_fees ? <p className="mt-1 text-xs text-white/60">Before taxes/fees: {rate.before_taxes_fees}</p> : null}<p className="my-2 text-xs text-white/70">{rate.inclusions.join(" · ") || "Rate conditions not supplied"}</p>{rate.offer ? <button type="button" onClick={() => onSelectRate(rate.offer!)} className="mr-2 mt-2 min-h-11 rounded-full bg-[#72d7dc] px-4 text-sm text-[#06181a]">Choose this rate</button> : <p className="text-xs text-amber-100">A verified full-stay amount is required to select this rate.</p>}{rate.link ? <a href={rate.link} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center rounded-full border border-amber-200/30 px-4 text-sm text-amber-100">Check with provider</a> : null}</article>)}</div>}
  </section></Modal>;
}
