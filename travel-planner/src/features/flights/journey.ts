import type { FlightOption, FlightSegment } from "../../domain/travel";

export type JourneyLeg = { label: "Outbound" | "Return"; segments: FlightSegment[]; duration?: number | null };
export function journeyLegs(offer: FlightOption): JourneyLeg[] {
  const segments = offer.segments || [];
  if (!segments.length) return [];
  if (!offer.has_return_details) return [{ label: "Outbound", segments, duration: offer.total_duration_minutes }];
  const count = offer.outbound_segment_count;
  if (!count || !Number.isInteger(count) || count < 1 || count >= segments.length) return [];
  return [{ label: "Outbound", segments: segments.slice(0, count), duration: offer.outbound_duration_minutes },
    { label: "Return", segments: segments.slice(count), duration: offer.return_duration_minutes }];
}

function localParts(value?: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  return { date, time: `${match[4]}:${match[5]}` };
}

/** Calendar-day change in provider-supplied airport times, NOT elapsed duration. */
export function arrivalDayChange(departure?: string | null, arrival?: string | null): number | null {
  const from = localParts(departure); const to = localParts(arrival);
  return from && to ? Math.round((to.date.getTime() - from.date.getTime()) / 86_400_000) : null;
}

export function airportTime(value?: string | null): string {
  const parts = localParts(value);
  return parts ? `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parts.date)}, ${parts.time}` : "Time not supplied";
}
