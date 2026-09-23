import type { FlightOption } from "../../domain/travel";
import { Modal } from "../search/Modal";
import { formatFlightDuration, formatFlightPrice, formatFlightDateTime, getFlightAirlines } from "../search/shared";
import { flightStops } from "./comparison";

export function FlightComparison({ offers, onClose, onReview }: { offers: FlightOption[]; onClose: () => void; onReview: (offer: FlightOption) => void }) {
  const rows: [string, (offer: FlightOption) => string][] = [
    ["Total price", formatFlightPrice], ["Journey", (offer) => offer.has_return_details ? "Round trip" : "Return still to choose"],
    ["Airline", getFlightAirlines], ["Duration", (offer) => formatFlightDuration(offer.total_duration_minutes)],
    ["Outbound departs", (offer) => formatFlightDateTime(offer.segments?.[0]?.depart_at)],
    ["Stops per leg", (offer) => { const stops = flightStops(offer); return stops === null ? "Not supplied" : stops === 0 ? "Nonstop" : `Up to ${stops}`; }],
    ["Baggage & cancellation", () => "Confirm with provider"],
  ];
  return <Modal label="Compare flights" onClose={onClose}><section className="w-full max-w-5xl rounded-3xl border border-[#72d7dc]/25 bg-[#0e1518] p-5">
    <div className="flex items-center justify-between gap-3"><h2 className="text-2xl text-white">Compare flights</h2><button type="button" onClick={onClose} className="min-h-11 rounded-full border border-white/20 px-4">Close comparison</button></div>
    <p className="my-3 text-sm text-white/65">Prices are for all travelers in each search. Confirm current totals with the provider.</p>
    <div role="region" aria-label="Flight comparison table" tabIndex={0} className="overflow-x-auto">
      <table className="w-full min-w-[580px] text-left text-sm"><thead><tr><th scope="col" className="p-3">Compare</th>{offers.map((offer, index) => <th scope="col" key={offer.id} className="p-3 text-[#a9f1f1]">Option {index + 1}</th>)}</tr></thead>
        <tbody>{rows.map(([label, render]) => <tr key={label} className="border-t border-white/10"><th scope="row" className="p-3 font-normal text-white/60">{label}</th>{offers.map((offer) => <td key={offer.id} className="p-3">{render(offer)}</td>)}</tr>)}
          <tr><th scope="row" className="p-3 font-normal text-white/60">Next step</th>{offers.map((offer) => <td key={offer.id} className="p-3"><button type="button" onClick={() => onReview(offer)} className="min-h-11 rounded-full bg-[#72d7dc] px-4 text-[#06181a]">Review flight</button></td>)}</tr>
        </tbody>
      </table>
    </div>
  </section></Modal>;
}
