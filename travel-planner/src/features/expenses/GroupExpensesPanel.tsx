import type { SavedTrip } from "../../domain/travel";
import { Modal } from "../search/Modal";
import { ExactLedger } from "./ExactLedger";

export function GroupExpensesPanel({ trip, onClose, onTripUpdated }: { trip: SavedTrip | null; onClose: () => void; onTripUpdated: (trip: SavedTrip) => void }) {
  if (!trip) return null;
  return <Modal label={`Group expenses: ${trip.name}`} onClose={onClose}><div className="max-h-[92dvh] w-full max-w-6xl overflow-y-auto rounded-[30px] border border-[#72d7dc]/25 bg-[#0e1518] p-5 sm:p-8"><header className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-[#72d7dc]">Trip money</p><h2 className="mt-2 text-3xl text-white">{trip.name}</h2><p className="mt-2 text-sm text-white/75">Owner-managed expenses and settlements.</p></div><button onClick={onClose} className="min-h-11 rounded-full border border-white/25 px-4 text-white">Close expenses</button></header><ExactLedger key={trip.id} trip={trip} onUpdated={onTripUpdated} /></div></Modal>;
}
