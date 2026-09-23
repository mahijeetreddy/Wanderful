import type { FlightOption } from "../../domain/travel";
import { initialFilters, type FlightFilters as FilterState } from "./comparison";

export function FlightFilters({ offers, value, onChange, currency }: { offers: FlightOption[]; value: FilterState; onChange: (value: FilterState) => void; currency: string }) {
  const airlines = [...new Set(offers.flatMap((offer) => offer.segments?.map((segment) => segment.airline).filter(Boolean) || []))] as string[];
  const cabins = [...new Set(offers.flatMap((offer) => offer.segments?.map((segment) => segment.travel_class).filter(Boolean) || []))] as string[];
  const select = (key: "sort" | "airline" | "stops" | "cabin" | "departure", label: string, choices: [string, string][]) => <label className="text-xs text-white/70">{label}<select aria-label={label} value={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-[#72d7dc]/20 bg-[#0e1518] px-3 text-sm text-white">{choices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
  return <section aria-label="Filter flights" className="space-y-3 rounded-2xl border border-[#72d7dc]/20 bg-[#0e1518] p-4">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {select("sort", "Sort flights", [["best", "Best fit"], ["cheapest", "Cheapest"], ["fastest", "Fastest"]])}
      {select("airline", "Airline", [["", "Any airline"], ...airlines.map((airline): [string, string] => [airline, airline])])}
      {select("stops", "Stops per leg", [["", "Any stops"], ["0", "Nonstop"], ["1", "Up to 1 stop"]])}
      {select("departure", "Outbound departure", [["", "Any time"], ["0", "00:00–05:59"], ["1", "06:00–11:59"], ["2", "12:00–17:59"], ["3", "18:00–23:59"]])}
      {cabins.length ? select("cabin", "Cabin", [["", "Any cabin"], ...cabins.map((cabin): [string, string] => [cabin, cabin])]) : null}
      <label className="text-xs text-white/70">Price target ({currency})<input aria-label="Flight price target" type="number" min="0" step="1" value={value.target} onChange={(event) => onChange({ ...value, target: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-[#72d7dc]/20 bg-[#0e1518] px-3 text-white" placeholder="Optional" /></label>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/70">
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={value.strict} onChange={(event) => onChange({ ...value, strict: event.target.checked })} className="h-4 w-4 accent-[#72d7dc]" />Only show prices within target</label>
      <button type="button" onClick={() => onChange(initialFilters)} className="min-h-11 px-3 text-[#a9f1f1]">Reset filters</button>
    </div>
  </section>;
}
