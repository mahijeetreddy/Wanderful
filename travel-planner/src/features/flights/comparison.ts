import type { FlightOption } from "../../domain/travel";

export type FlightFilters = { sort: "best" | "cheapest" | "fastest"; airline: string; stops: string; cabin: string; departure: string; target: string; strict: boolean };
export const initialFilters: FlightFilters = { sort: "best", airline: "", stops: "", cabin: "", departure: "", target: "", strict: false };
export const knownNumber = (value: unknown) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : Infinity;

/** Maximum stops on either leg; incomplete historical round trips remain unknown. */
export function flightStops(offer: FlightOption): number | null {
  const count = offer.segments?.length || 0;
  if (!count) return null;
  if (!offer.has_return_details) return count - 1;
  const outbound = offer.outbound_segment_count;
  return outbound && outbound > 0 && outbound < count ? Math.max(outbound - 1, count - outbound - 1) : null;
}

export function filterFlightOffers(offers: FlightOption[], filters: FlightFilters): FlightOption[] {
  return offers.filter((offer) => {
    const segments = offer.segments || [];
    if (filters.airline && !segments.some((segment) => segment.airline === filters.airline)) return false;
    if (filters.cabin && (!segments.length || !segments.every((segment) => segment.travel_class === filters.cabin))) return false;
    if (filters.stops) { const stops = flightStops(offer); if (stops === null || stops > Number(filters.stops)) return false; }
    if (filters.departure) {
      const hour = segments[0]?.depart_at?.match(/[T ](\d{2}):/)?.[1];
      if (!hour || Math.floor(Number(hour) / 6) !== Number(filters.departure)) return false;
    }
    if (filters.strict && filters.target && knownNumber(offer.total_price) > Number(filters.target)) return false;
    return true;
  }).sort((left, right) => {
    if (filters.sort === "cheapest") return knownNumber(left.total_price) - knownNumber(right.total_price);
    if (filters.sort === "fastest") return knownNumber(left.total_duration_minutes) - knownNumber(right.total_duration_minutes);
    return (left.rank ?? Infinity) - (right.rank ?? Infinity);
  });
}
