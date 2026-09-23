import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowRight, BookOpen, Bookmark, Braces, Building2, CalendarDays, Check, CircleUserRound, Clock, Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, Compass, Copy, Download, ExternalLink, FileText, FolderLock, ListChecks, Loader2, Lock, MapPin, Plane, ReceiptText, RotateCcw, Route, Search, Share2, Sparkles, Sun, Users, Wallet } from "lucide-react";
import { useMap } from "react-leaflet";
import type { Coordinates, FlightBookingOption, FlightOption, FlightRecoverySuggestion, HotelOption, PlannerForm, PlanResponse, PriceInsights } from "../../domain/travel";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { apiFetch } from "../../api/client";
import { OfferFreshness } from "../search/OfferFreshness";
import { ProviderRetry } from "../search/ProviderRetry";
import type { ProviderStatus } from "../../domain/travel";
import { HotelDetails } from "./HotelDetails";
import { StatPill, HotelMetric, EmptyResult, FlightControlField, inferInitialNightlyBudget, getTripDayCount, formatHotelMeta, formatFlightPrice, formatFlightDuration, getFlightAirlines, mergeFlightLegs, buildGoogleFlightsUrl, formatDate, formatFlightDateTime, MapRecenter, parsePlanResponse, useEscapeToClose } from "../search/shared";
const hotelMarker = L.divIcon({
  className: "hotel-marker",
  html: "<span></span>",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const selectedHotelMarker = L.divIcon({
  className: "hotel-marker hotel-marker-selected",
  html: "<span></span>",
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

export function HotelMapPanel({
  form,
  hotels,
  mapCenter,
  lockedHotelId,
  onLockHotel,
  onHotelsUpdated,
  providerStatus,
}: {
  form: PlannerForm;
  hotels: HotelOption[];
  mapCenter: Coordinates | null;
  lockedHotelId: string;
  onLockHotel: (hotelId: string) => void;
  onHotelsUpdated: (hotels: HotelOption[], mapCenter: Coordinates | null) => void;
  providerStatus?: ProviderStatus;
}) {
  const [selectedHotelId, setSelectedHotelId] = useState(hotels[0]?.id || "");
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const [detailsHotel, setDetailsHotel] = useState<HotelOption | null>(null);
  const mapShellRef = useRef<HTMLDivElement | null>(null);
  const [nightlyBudget, setNightlyBudget] = useState(() => inferInitialNightlyBudget(form));
  const [hotelStatus, setHotelStatus] = useState("");
  const [hotelStatusIsError, setHotelStatusIsError] = useState(false);
  const [hotelLoading, setHotelLoading] = useState(false);
  const hotelsWithCoordinates = hotels.filter((hotel) => hotel.coordinates);
  const selectedHotel = hotels.find((hotel) => hotel.id === selectedHotelId) || hotels[0];
  const center = selectedHotel?.coordinates || mapCenter || hotelsWithCoordinates[0]?.coordinates || { lat: 39.5, lng: -98.35 };

  useEffect(() => {
    setSelectedHotelId((current) => hotels.some((hotel) => hotel.id === current) ? current : hotels.find((hotel) => hotel.id === lockedHotelId)?.id || hotels[0]?.id || "");
  }, [hotels, lockedHotelId]);

  const selectHotel = (hotelId: string) => {
    setSelectedHotelId(hotelId);
  };

  const refreshHotels = async () => {
    setHotelLoading(true);
    setHotelStatus("");
    setHotelStatusIsError(false);
    try {
      const response = await apiFetch("/api/hotel-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, nightly_budget: nightlyBudget }),
      });
      const payload = await parsePlanResponse(response) as PlanResponse & {
        hotels?: HotelOption[];
        map_center?: Coordinates | null;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Could not update hotel options.");
      }
      const nextHotels = Array.isArray(payload.hotels) ? payload.hotels : [];
      onHotelsUpdated(nextHotels, payload.map_center || null);
      setHotelStatus(payload.message || "Hotel options updated.");
    } catch (caught) {
      setHotelStatus(caught instanceof Error ? caught.message : "Could not update hotel options.");
      setHotelStatusIsError(true);
    } finally {
      setHotelLoading(false);
    }
  };

  return (
    <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[0.92fr_1.08fr]">
      {detailsHotel ? <HotelDetails hotel={detailsHotel} onClose={() => setDetailsHotel(null)} onSelectRate={(offer) => {
        onHotelsUpdated([offer, ...hotels.filter((hotel) => hotel.id !== offer.id)], mapCenter);
        onLockHotel(offer.id);
        selectHotel(offer.id);
        setDetailsHotel(null);
      }} /> : null}
      <div className="flex gap-2 lg:hidden" role="group" aria-label="Stay view">
        <button type="button" aria-pressed={mobileView === "list"} onClick={() => setMobileView("list")} className="min-h-11 flex-1 rounded-full border border-[#72d7dc]/30 px-4 text-[#a9f1f1]">List</button>
        <button type="button" aria-pressed={mobileView === "map"} onClick={() => setMobileView("map")} className="min-h-11 flex-1 rounded-full border border-[#72d7dc]/30 px-4 text-[#a9f1f1]">Map</button>
      </div>
      <div className={`${mobileView === "list" ? "block" : "hidden lg:block"} space-y-3 pr-1 lg:max-h-[850px] lg:overflow-auto`}>
        <ProviderRetry form={form} kind="hotels" status={providerStatus} onResults={(result) => onHotelsUpdated(result.hotels || [], result.map_center || null)} />
        {!hotels.length ? <p className="p-3 text-sm text-white/70">No stays to show. Search controls remain available below.</p> : null}
        <div className="rounded-[28px] border border-[#3fb6c4]/12 bg-[radial-gradient(circle_at_20%_0%,rgba(63,182,196,0.16),transparent_34%),rgba(0,0,0,0.68)] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.28)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#72d7dc]">Stays</p>
              <h4 className="mt-1 text-2xl font-medium tracking-[-0.04em] text-white">Choose your base</h4>
            </div>
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#3fb6c4] text-[#06181a] shadow-[0_0_38px_rgba(63,182,196,0.18)]">
              <Building2 size={20} />
            </div>
          </div>
          <div className="mt-4 rounded-[22px] border border-[#3fb6c4]/10 bg-[#0e1518]/35 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/42">Up to per night</p>
                <p className="mt-1 text-lg font-medium text-white">{form.currency_code || "USD"} {nightlyBudget}</p>
              </div>
              <button
                type="button"
                onClick={refreshHotels}
                disabled={hotelLoading}
                className="inline-flex items-center gap-2 rounded-full bg-[#3fb6c4] px-4 py-2.5 text-sm font-medium text-[#06181a] transition hover:scale-[1.01] disabled:opacity-60"
              >
                {hotelLoading ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />}
                Search
              </button>
            </div>
            <input
              aria-label="Maximum nightly stay price"
              type="range"
              min="50"
              max="1200"
              step="25"
              value={nightlyBudget}
              onChange={(event) => setNightlyBudget(Number(event.target.value))}
              className="mt-4 w-full accent-white"
            />
            <div className="mt-2 flex justify-between text-[11px] text-white/38">
              <span>{form.currency_code || "USD"} 50</span>
              <span>{form.currency_code || "USD"} 1200+</span>
            </div>
            {hotelStatus ? (
              <p className={`mt-3 text-sm leading-relaxed ${hotelStatusIsError ? "text-red-300/85" : "text-white/56"}`}>
                {hotelStatus}
              </p>
            ) : null}
          </div>
        </div>
        {hotels.map((hotel, hotelIndex) => (
          <article
            key={hotel.id}
            style={{ animationDelay: `${Math.min(hotelIndex, 8) * 45}ms` }}
            className={`hotel-option-card stay-card card-hover card-enter group w-full cursor-pointer rounded-[26px] border p-4 text-left focus:outline-none focus:ring-2 focus:ring-[#3fb6c4]/30 ${
              selectedHotel?.id === hotel.id
                ? "stay-card-selected border-[#3fb6c4]/60 bg-[#3fb6c4]/[0.16]"
                : "border-[#3fb6c4]/12 bg-[#0e1518]/58 hover:border-[#3fb6c4]/28 hover:bg-[#3fb6c4]/[0.08]"
            }`}
          >
            <HotelImage src={hotel.image_thumbnail} name={hotel.name} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#72d7dc]">{hotel.rank ? `Choice ${hotel.rank}` : hotel.hotel_class || "Stay"}</p>
                <p className="mt-1 text-xl font-medium leading-tight text-white">{hotel.name}</p>
                {hotel.rate_source || hotel.room_type ? <p className="mt-2 text-sm text-amber-100">{hotel.room_type || "Room not specified"}{hotel.rate_source ? ` · ${hotel.rate_source}` : ""}</p> : null}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="text-xl font-semibold text-white">{hotel.estimated_total != null ? `${hotel.currency || form.currency_code} ${hotel.estimated_total}` : "Price unavailable"}</span>
                <span className="text-xs text-white/65">{hotel.price_basis === "provider_stay_total" ? "Full-stay quote" : "Full-stay estimate"}</span>
                {hotel.nightly_rate ? <span className="text-xs text-white/60">{hotel.nightly_rate} / night</span> : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {hotel.rating ? <HotelMetric label="Rating" value={`${hotel.rating}${hotel.reviews ? ` (${hotel.reviews})` : ""}`} /> : null}
            </div>
            <OfferFreshness offer={hotel} />
            <p className="text-xs text-white/60">Room, taxes and cancellation terms: confirm with provider.</p>
            {hotel.amenities?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {hotel.amenities.slice(0, 4).map((amenity) => (
                  <span key={amenity} className="rounded-full border border-[#3fb6c4]/10 bg-[#0e1518]/20 px-2.5 py-1 text-[11px] text-white/62">
                    {amenity}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2"><button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                selectHotel(hotel.id);
                onLockHotel(lockedHotelId === hotel.id ? "" : hotel.id);
              }}
              className={`min-h-11 rounded-full px-4 py-2 text-sm transition ${
                lockedHotelId === hotel.id ? "bg-[#3fb6c4] text-[#06181a]" : "border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.06] text-white/72 hover:bg-[#3fb6c4]/12"
              }`}
            >
              {lockedHotelId === hotel.id ? "Selected" : "Choose stay"}
            </button>
            <button type="button" onClick={() => setDetailsHotel(hotel)} className="min-h-11 rounded-full border border-amber-200/25 px-4 text-sm text-amber-100">Stay details</button>
            {hotel.coordinates ? <button type="button" onClick={() => { selectHotel(hotel.id); setMobileView("map"); }} className="min-h-11 rounded-full border border-[#72d7dc]/25 px-4 text-sm text-[#a9f1f1]">Show on map</button> : null}
            {hotel.link ? (
              <a
                href={hotel.link}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.08] px-3 py-1.5 text-sm text-white/78 transition hover:bg-[#3fb6c4] hover:text-[#06181a]"
              >
                View hotel <ExternalLink size={12} />
              </a>
            ) : null}
            </div>
          </article>
        ))}
      </div>

      <div ref={mapShellRef} className={`${mobileView === "map" ? "block" : "hidden lg:block"} hotel-map-shell relative min-h-[540px] overflow-hidden rounded-[34px] border border-[#3fb6c4]/14 bg-[#0e1518]/60 shadow-[0_32px_110px_rgba(0,0,0,0.44)]`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] h-28 bg-gradient-to-b from-black/70 to-transparent" />
        <div className="pointer-events-none absolute left-4 right-4 top-4 z-[501] flex flex-wrap items-start justify-between gap-3">
          <div className="rounded-2xl border border-[#3fb6c4]/12 bg-[#0e1518]/72 px-4 py-3 backdrop-blur-md">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">Map</p>
            <p className="mt-1 text-sm font-medium text-white">{hotelsWithCoordinates.length} stay{hotelsWithCoordinates.length === 1 ? "" : "s"}</p>
          </div>
          {selectedHotel ? (
            <div className="max-w-[320px] rounded-2xl border border-[#3fb6c4]/12 bg-[#0e1518]/72 px-4 py-3 text-right backdrop-blur-md">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">Selected Stay</p>
              <p className="mt-1 truncate text-sm font-medium text-white">{selectedHotel.name}</p>
              <p className="mt-1 text-xs text-white/55">{formatHotelMeta(selectedHotel)}</p>
            </div>
          ) : null}
        </div>
        {hotelsWithCoordinates.length ? (
          <MapContainer center={[center.lat, center.lng]} zoom={12} scrollWheelZoom className="hotel-map">
            <HotelMapResize view={mobileView} />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapRecenter center={center} />
            {hotelsWithCoordinates.map((hotel) => {
              const coordinates = hotel.coordinates as Coordinates;
              const selected = hotel.id === selectedHotel?.id;
              return (
                <Marker
                  key={hotel.id}
                  position={[coordinates.lat, coordinates.lng]}
                  icon={selected ? selectedHotelMarker : hotelMarker}
                  eventHandlers={{ click: () => selectHotel(hotel.id) }}
                >
                  <Popup>
                    <strong>{hotel.name}</strong>
                    <br />
                    {formatHotelMeta(hotel)}
                    <br /><button type="button" onClick={() => { selectHotel(hotel.id); onLockHotel(hotel.id); }} className="min-h-11 px-3">{lockedHotelId === hotel.id ? "Selected" : "Choose this stay"}</button>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        ) : (
          <EmptyResult
            icon={<MapPin size={18} />}
            title="Map unavailable for these hotel results"
            text="These stays have no verified map location. Switch to List to compare them."
          />
        )}
      </div>
    </div>
  );
}

function HotelImage({ src, name }: { src?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <div className="relative mb-4 grid h-44 place-items-center overflow-hidden rounded-[20px] border border-[#72d7dc]/15 bg-gradient-to-br from-[#17444b] via-[#0e252b] to-[#352d23]">
    {src && !failed ? <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" /> : <div className="text-center text-[#a9dada]"><Building2 size={32} className="mx-auto" /><span className="mt-2 block text-xs">Photo unavailable</span></div>}
  </div>;
}

function HotelMapResize({ view }: { view: string }) {
  const map = useMap();
  useEffect(() => { map.invalidateSize(); }, [map, view]);
  return null;
}
