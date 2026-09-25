import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowRight, BookOpen, Bookmark, Braces, Building2, CalendarDays, Check, CircleUserRound, Clock, Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, Compass, Copy, Download, ExternalLink, FileText, FolderLock, ListChecks, Loader2, Lock, MapPin, Plane, ReceiptText, RotateCcw, Route, Search, Share2, Sparkles, Sun, Users, Wallet } from "lucide-react";
import { useMap } from "react-leaflet";
import type { Coordinates, FlightBookingOption, FlightOption, FlightRecoverySuggestion, HotelOption, PlannerForm, PlanResponse, PriceInsights } from "../../domain/travel";

export function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#3fb6c4]/10 bg-[#0e1518]/35 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-white/38">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-white">{value}</p>
    </div>
  );
}

export function HotelMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.075] px-3 py-1.5 text-xs text-white/74">
      <span className="text-white/38">{label}</span> {value}
    </span>
  );
}

export function EmptyResult({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[26px] border border-[#3fb6c4]/12 bg-[#0e1518]/62 p-8 text-center">
      <div className="mb-3 rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.07] p-3 text-white/68">{icon}</div>
      <p className="text-lg font-medium text-white">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-white/55">{text}</p>
    </div>
  );
}

export function FlightControlField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.15em] text-white/52">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-2xl border border-[#3fb6c4]/14 bg-[#0e1518]/60 px-3 text-sm text-white outline-none transition placeholder:text-white/34 focus:border-[#3fb6c4]/38 focus:bg-[#0e1518]/75"
      />
    </label>
  );
}

export function inferInitialNightlyBudget(form: PlannerForm) {
  const budget = Number(form.budget);
  const start = new Date(`${form.start_date}T00:00:00`);
  const end = new Date(`${form.end_date}T00:00:00`);
  const nights = Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
    ? 3
    : Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
  if (!Number.isFinite(budget) || budget <= 0) {
    return 250;
  }
  return Math.min(1200, Math.max(50, Math.round((budget * 0.38) / nights / 25) * 25));
}

export function getTripDayCount(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 0;
  }
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.min(14, Math.max(1, Math.round((end.getTime() - start.getTime()) / dayMs) + 1));
}

export function formatHotelMeta(hotel: HotelOption) {
  const parts = [];
  if (hotel.rating) {
    parts.push(`${hotel.rating} rating`);
  }
  if (hotel.reviews) {
    parts.push(`${hotel.reviews} reviews`);
  }
  if (hotel.nightly_rate) {
    parts.push(`${hotel.nightly_rate}/night`);
  } else if (hotel.extracted_nightly_rate) {
    parts.push(`${hotel.currency || "USD"} ${hotel.extracted_nightly_rate}/night`);
  }
  if (hotel.estimated_total) {
    parts.push(`${hotel.currency || "USD"} ${hotel.estimated_total} estimated total`);
  }
  return parts.length ? parts.join(" - ") : "Hotel details available";
}

export function formatFlightPrice(flight: FlightOption) {
  if (flight.total_price) {
    return `${flight.currency || "USD"} ${flight.total_price}`;
  }
  return "Price unavailable";
}

export function formatFlightDuration(minutes?: number | null) {
  if (!minutes || minutes <= 0) {
    return "Duration unavailable";
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (!hours) {
    return `${remainingMinutes}m`;
  }
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function getFlightAirlines(flight: FlightOption) {
  const airlines = Array.from(
    new Set((flight.segments || []).map((segment) => segment.airline).filter(Boolean) as string[])
  );
  return airlines.length ? airlines.slice(0, 3).join(", ") : "Airline TBD";
}

export function mergeFlightLegs(outbound: FlightOption, returnOption: FlightOption): FlightOption {
  if (returnOption.snapshot_id) return returnOption;
  return {
    ...outbound,
    ...returnOption,
    id: `${outbound.id}-${returnOption.id}`,
    snapshot_id: undefined,
    freshness: "historical",
    segments: [...(outbound.segments || []), ...(returnOption.segments || [])],
    total_price: returnOption.total_price ?? outbound.total_price,
    currency: returnOption.currency || outbound.currency,
    booking_token: returnOption.booking_token || outbound.booking_token,
    departure_token: returnOption.departure_token || outbound.departure_token,
    has_return_details: true,
    reference: returnOption.reference || outbound.reference,
  };
}

export function buildGoogleFlightsUrl(search: { origin: string; destination: string; start_date: string; end_date: string }) {
  const query = `${search.origin} to ${search.destination} ${search.start_date} ${search.end_date}`.trim();
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`;
}

export function formatDate(value: string) {
  if (!value) {
    return "TBD";
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function formatFlightDateTime(value?: string | null) {
  if (!value) {
    return "Time TBD";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function MapRecenter({ center }: { center: Coordinates }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], map.getZoom(), { animate: true });
  }, [center, map]);
  return null;
}

export async function parsePlanResponse(response: Response): Promise<PlanResponse> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!text.trim()) {
    return {
      error: `API returned an empty response with status ${response.status}. Check that Flask is running and Vite is proxying to the correct port.`,
    };
  }

  try {
    return JSON.parse(text) as PlanResponse;
  } catch {
    const looksLikeHtml = contentType.includes("text/html") || /^\s*</.test(text);
    return {
      error: looksLikeHtml
        ? `API returned HTML instead of JSON with status ${response.status}. This usually means the Flask API is not running on the Vite proxy target, or the request hit the frontend fallback route. Restart Flask on port 5052 and hard refresh.`
        : `API returned non-JSON response with status ${response.status}: ${text.slice(0, 240)}`,
    };
  }
}

export function useEscapeToClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose]);
}
