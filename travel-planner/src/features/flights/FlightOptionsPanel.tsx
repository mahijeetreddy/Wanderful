import { FlightJourney } from "./FlightJourney";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowRight, BookOpen, Bookmark, Braces, Building2, CalendarDays, Check, CircleUserRound, Clock, Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, Compass, Copy, Download, ExternalLink, FileText, FolderLock, ListChecks, Loader2, Lock, MapPin, Plane, ReceiptText, RotateCcw, Route, Search, Share2, Sparkles, Sun, Users, Wallet } from "lucide-react";
import { useMap } from "react-leaflet";
import type { Coordinates, FlightBookingOption, FlightOption, FlightRecoverySuggestion, HotelOption, PlannerForm, PlanResponse, PriceInsights } from "../../domain/travel";
import { apiFetch } from "../../api/client";
import { OfferFreshness } from "../search/OfferFreshness";
import { Modal } from "../search/Modal";
import { ProviderRetry } from "../search/ProviderRetry";
import type { ProviderStatus } from "../../domain/travel";
import { FlightFilters } from "./FlightFilters";
import { FlightComparison } from "./FlightComparison";
import { filterFlightOffers, initialFilters, flightStops, knownNumber } from "./comparison";
import { StatPill, HotelMetric, EmptyResult, FlightControlField, inferInitialNightlyBudget, getTripDayCount, formatHotelMeta, formatFlightPrice, formatFlightDuration, getFlightAirlines, mergeFlightLegs, buildGoogleFlightsUrl, formatDate, formatFlightDateTime, MapRecenter, parsePlanResponse, useEscapeToClose } from "../search/shared";

export function FlightOptionsPanel({
  form,
  flights,
  recovery,
  priceInsights,
  lockedFlightId,
  onLockFlight,
  onFlightsUpdated,
  providerStatus,
}: {
  form: PlannerForm;
  flights: FlightOption[];
  recovery: FlightRecoverySuggestion[];
  priceInsights: PriceInsights | null;
  lockedFlightId: string;
  onLockFlight: (flightId: string) => void;
  onFlightsUpdated: (flights: FlightOption[]) => void;
  providerStatus?: ProviderStatus;
}) {
  const [instruction, setInstruction] = useState("");
  const [filters, setFilters] = useState(initialFilters);
  const [comparison, setComparison] = useState<FlightOption[]>([]);
  const [comparing, setComparing] = useState(false);
  const [currentFlights, setCurrentFlights] = useState(flights);
  const [currentRecovery, setCurrentRecovery] = useState(recovery);
  const [currentPriceInsights, setCurrentPriceInsights] = useState(priceInsights);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedFlight, setSelectedFlight] = useState<FlightOption | null>(null);
  const [flightSearch, setFlightSearch] = useState({
    origin: form.origin,
    destination: form.destination,
    start_date: form.start_date,
    end_date: form.end_date,
  });

  useEffect(() => {
    setCurrentFlights(flights);
    setCurrentRecovery(recovery);
    setCurrentPriceInsights(priceInsights);
  }, [flights, recovery, priceInsights]);

  useEffect(() => {
    setInstruction("");
    setStatus("");
    setFlightSearch({
      origin: form.origin,
      destination: form.destination,
      start_date: form.start_date,
      end_date: form.end_date,
    });
  }, [form.origin, form.destination, form.start_date, form.end_date]);

  const searchAlternates = async (nextInstruction: string, overrides = flightSearch) => {
    const cleaned = nextInstruction.trim();
    setLoading(true);
    setStatus("");
    try {
      const response = await apiFetch("/api/flight-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ...overrides,
          instruction: cleaned || "manual flight search",
        }),
      });
      const payload = await parsePlanResponse(response) as PlanResponse & {
        flights?: FlightOption[];
        recovery_suggestions?: FlightRecoverySuggestion[];
        message?: string;
        price_insights?: PriceInsights | null;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Flight search failed.");
      }
      const retained = currentFlights.filter((item) => item.id === lockedFlightId);
      const next = [...retained, ...(payload.flights || []).filter((item) => item.id !== lockedFlightId)];
      onFlightsUpdated(next);
      setCurrentFlights(next);
      setCurrentRecovery(payload.recovery_suggestions || []);
      setCurrentPriceInsights(payload.price_insights || null);
      setStatus(payload.message || "Updated flight options.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Flight search failed.");
    } finally {
      setLoading(false);
    }
  };

  const visibleFlights = filterFlightOffers(currentFlights, filters);
  return (
    <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <ProviderRetry form={form} kind="flights" status={providerStatus} onResults={(result) => {
          const retained = currentFlights.filter((offer) => offer.id === lockedFlightId);
          onFlightsUpdated([...retained, ...(result.flights || []).filter((offer) => offer.id !== lockedFlightId)]);
        }} />
        <div className="rounded-[28px] border border-[#3fb6c4]/12 bg-[radial-gradient(circle_at_12%_0%,rgba(63,182,196,0.16),transparent_36%),rgba(0,0,0,0.68)] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.28)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#72d7dc]">Flights</p>
              <h4 className="mt-1 text-2xl font-medium tracking-[-0.04em] text-white">
                {flightSearch.origin || "Origin"} to {flightSearch.destination || "Destination"}
              </h4>
            </div>
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#3fb6c4] text-[#06181a] shadow-[0_0_38px_rgba(63,182,196,0.18)]">
              <Plane size={20} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <StatPill label="Options" value={String(currentFlights.length)} />
            <StatPill label="Depart" value={formatDate(flightSearch.start_date)} />
            <StatPill label="Return" value={formatDate(flightSearch.end_date)} />
          </div>
          {currentPriceInsights?.typical_price_range ? (
            <p className="mt-3 text-xs text-white/50">
              Typical price for this route: {form.currency_code || "USD"} {currentPriceInsights.typical_price_range[0]}-{currentPriceInsights.typical_price_range[1]}
              {currentPriceInsights.price_level ? ` (currently ${currentPriceInsights.price_level})` : ""}
            </p>
          ) : null}
        </div>

        <FlightFilters offers={currentFlights} value={filters} onChange={setFilters} currency={form.currency_code} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/70">
          <span>{visibleFlights.length} of {currentFlights.length} options</span>
          <button type="button" disabled={comparison.length < 2} onClick={() => setComparing(true)} className="min-h-11 rounded-full border border-amber-200/30 px-4 text-amber-100 disabled:opacity-40">Compare flights ({comparison.length}/3)</button>
          {comparison.length ? <button type="button" onClick={() => setComparison([])} className="min-h-11 px-3">Clear comparison</button> : null}
        </div>
        {comparing ? <FlightComparison offers={comparison} onClose={() => setComparing(false)} onReview={(offer) => { setComparing(false); setSelectedFlight(offer); }} /> : null}
        {currentFlights.length && !visibleFlights.length ? <p className="rounded-2xl border border-white/10 p-4 text-sm text-white/65">No options match these filters. Reset filters to see all results. Your saved selection is unchanged.</p> : null}
        {visibleFlights.length ? (
          visibleFlights.map((flight, flightIndex) => (
            <article
              key={flight.id}
              style={{ animationDelay: `${Math.min(flightIndex, 8) * 45}ms` }}
              className="flight-option-card flight-ticket card-hover card-enter block w-full cursor-pointer overflow-hidden rounded-[28px] border border-[#3fb6c4]/12 bg-[#0e1518]/70 p-5 text-left shadow-[0_20px_70px_rgba(0,0,0,0.28)] hover:border-[#3fb6c4]/28 focus:outline-none focus:ring-2 focus:ring-[#3fb6c4]/30"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                    {flight.rank ? `Choice ${flight.rank}` : `Flight ${flightIndex + 1}`}
                  </p>
                  <p className="mt-1 text-3xl font-medium tracking-[-0.05em] text-white">{formatFlightPrice(flight)}</p>
                  <p className="mt-1 text-xs text-white/65">Total for {String(flight.search_context?.adults || form.adults)} traveler(s) · {flight.has_return_details ? "round trip" : "confirm total after choosing return"}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/62">
                    <span className="rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.07] px-3 py-1.5">{formatFlightDuration(flight.total_duration_minutes)}</span>
                    <span className="rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.07] px-3 py-1.5">
                      {flight.has_return_details ? "Round trip" : "Outbound shown"}
                    </span>
                    <span className="rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.07] px-3 py-1.5">{getFlightAirlines(flight)}</span>
                    {flightStops(flight) === 0 ? <span className="rounded-full bg-[#3fb6c4]/15 px-3 py-1.5 text-[#a9f1f1]">Nonstop</span> : null}
                    {filters.target && knownNumber(flight.total_price) <= Number(filters.target) ? <span className="rounded-full bg-amber-200/10 px-3 py-1.5 text-amber-100">Within your target</span> : null}
                  </div>
                </div>
              </div>

              <OfferFreshness offer={flight} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex min-h-11 items-center gap-2 text-sm text-white/75"><input type="checkbox" aria-label={`Compare option ${flightIndex + 1}`} checked={comparison.some((offer) => offer.id === flight.id)} disabled={comparison.length >= 3 && !comparison.some((offer) => offer.id === flight.id)} onChange={(event) => setComparison((current) => event.target.checked ? [...current, flight].slice(0, 3) : current.filter((offer) => offer.id !== flight.id))} className="h-4 w-4 accent-[#72d7dc]" />Compare</label>
                <button type="button" onClick={() => setSelectedFlight(flight)} className="min-h-11 px-3 text-sm text-[#a9f1f1]">Flight details</button>
              </div>
              <FlightJourney offer={flight} />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#3fb6c4]/10 pt-4">
                {flight.carbon_emissions?.difference_percent != null ? <p className="text-xs text-white/42">CO₂ {Math.abs(flight.carbon_emissions.difference_percent)}% {flight.carbon_emissions.difference_percent < 0 ? "below" : "above"} typical</p> : <span/>}
                <a
                  href={buildGoogleFlightsUrl(flightSearch)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.08] px-3 py-1.5 text-sm text-white/78 transition hover:bg-[#3fb6c4] hover:text-[#06181a]"
                >
                  Open Google Flights <ExternalLink size={13} />
                </a>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!flight.has_return_details) setSelectedFlight(flight);
                    else onLockFlight(lockedFlightId === flight.id ? "" : flight.id);
                  }}
                  className={`rounded-full px-3 py-1.5 text-sm transition ${
                    lockedFlightId === flight.id ? "bg-[#3fb6c4] text-[#06181a]" : "border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.08] text-white/78 hover:bg-[#3fb6c4] hover:text-[#06181a]"
                  }`}
                >
                  {lockedFlightId === flight.id ? "Selected" : "Choose flight"}
                </button>
              </div>
            </article>
          ))
        ) : !currentFlights.length ? (
          <EmptyResult
            icon={<Plane size={18} />}
            title="No flight options returned"
            text="Try nearby dates or airports."
          />
        ) : null}
      </div>

      <aside className="space-y-3">
        <div className="rounded-[26px] border border-[#3fb6c4]/12 bg-[#0e1518]/68 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/60">Flight search controls</p>
          <div className="mt-3 grid gap-3">
            <FlightControlField
              label="Origin"
              value={flightSearch.origin}
              placeholder="LAX or Los Angeles"
              onChange={(value) => setFlightSearch((current) => ({ ...current, origin: value }))}
            />
            <FlightControlField
              label="Destination"
              value={flightSearch.destination}
              placeholder="SJC or San Jose"
              onChange={(value) => setFlightSearch((current) => ({ ...current, destination: value }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <FlightControlField
                type="date"
                label="Depart"
                value={flightSearch.start_date}
                onChange={(value) => setFlightSearch((current) => ({ ...current, start_date: value }))}
              />
              <FlightControlField
                type="date"
                label="Return"
                value={flightSearch.end_date}
                onChange={(value) => setFlightSearch((current) => ({ ...current, end_date: value }))}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => searchAlternates("manual flight search", flightSearch)}
            disabled={loading}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-[#3fb6c4] px-4 py-3 text-sm font-medium text-[#06181a] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />}
            Check these flights
          </button>
        </div>

        <div className="rounded-[26px] border border-[#3fb6c4]/12 bg-[#0e1518]/68 p-4 shadow-[0_18px_55px_rgba(0,0,0,0.2)]">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">Try another search</p>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={4}
            placeholder="Leave two days earlier or try a nearby airport."
            className="mt-3 w-full resize-none rounded-2xl border border-[#3fb6c4]/16 bg-[#0e1518]/68 p-3 text-sm text-white outline-none placeholder:text-white/42 focus:border-[#3fb6c4]/42"
          />
          <button
            type="button"
            onClick={() => searchAlternates(instruction, flightSearch)}
            disabled={loading || !instruction.trim()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-[#3fb6c4] px-4 py-3 text-sm font-medium text-[#06181a] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />}
            Search alternate flights
          </button>
          {status ? <p className="mt-3 text-sm leading-relaxed text-white/58">{status}</p> : null}
        </div>

        {currentRecovery.length ? (
          <div className="rounded-[26px] border border-[#3fb6c4]/12 bg-[#0e1518]/68 p-4 shadow-[0_18px_55px_rgba(0,0,0,0.2)]">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">Suggestions</p>
            <div className="mt-3 space-y-2">
              {currentRecovery.map((suggestion) => (
                <button
                  key={`${suggestion.type}-${suggestion.instruction}`}
                  type="button"
                  onClick={() => {
                    setInstruction(suggestion.instruction);
                    void searchAlternates(suggestion.instruction, flightSearch);
                  }}
                  className="w-full rounded-2xl border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.055] px-3 py-2 text-left text-sm leading-relaxed text-white/72 transition hover:border-[#3fb6c4]/24 hover:bg-[#3fb6c4]/[0.11] hover:text-white"
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </aside>

      <FlightDetailModal
        flight={selectedFlight}
        currencyCode={form.currency_code}
        search={flightSearch}
        onClose={() => setSelectedFlight(null)}
        onSelect={(completed) => {
          onFlightsUpdated([completed, ...currentFlights.filter((item) => item.id !== completed.id)]);
          onLockFlight(completed.id);
          setSelectedFlight(null);
        }}
      />
    </div>
  );
}

function FlightDetailModal({
  flight,
  currencyCode,
  search,
  onClose,
  onSelect,
}: {
  flight: FlightOption | null;
  currencyCode: string;
  search: { origin: string; destination: string; start_date: string; end_date: string };
  onClose: () => void;
  onSelect: (flight: FlightOption) => void;
}) {
  const [bookingOptions, setBookingOptions] = useState<FlightBookingOption[]>([]);
  const [returnOptions, setReturnOptions] = useState<FlightOption[]>([]);
  const [activeFlight, setActiveFlight] = useState<FlightOption | null>(flight);
  const [bookingStatus, setBookingStatus] = useState("");
  const [returnStatus, setReturnStatus] = useState("");
  const [selectedReturnId, setSelectedReturnId] = useState("");
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [loadingReturns, setLoadingReturns] = useState(false);

  useEffect(() => {
    if (flight) {
      setActiveFlight(flight);
    }
    setBookingOptions([]);
    setBookingStatus("");
    setReturnOptions([]);
    setReturnStatus("");
    setSelectedReturnId("");
  }, [flight]);

  if (!flight || !activeFlight) {
    return null;
  }

  const loadBookingOptions = async () => {
    if (!activeFlight.booking_token) {
      setBookingStatus("Open Google Flights to continue.");
      return;
    }
    setLoadingBookings(true);
    setBookingStatus("");
    try {
      const response = await apiFetch("/api/flight-booking-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_token: activeFlight.booking_token, currency_code: currencyCode || "USD" }),
      });
      const payload = await parsePlanResponse(response) as {
        booking_options?: FlightBookingOption[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Could not load booking options.");
      }
      setBookingOptions(Array.isArray(payload.booking_options) ? payload.booking_options : []);
      setBookingStatus(
        payload.booking_options?.length
          ? "Booking options ready."
          : "No direct booking links found. Open Google Flights to continue."
      );
    } catch (caught) {
      setBookingStatus(caught instanceof Error ? caught.message : "Could not load booking options.");
    } finally {
      setLoadingBookings(false);
    }
  };

  const loadReturnOptions = async () => {
    if (!activeFlight.departure_token) {
      setReturnStatus("Open Google Flights to choose the return.");
      return;
    }
    setLoadingReturns(true);
    setReturnStatus("");
    setBookingOptions([]);
    setBookingStatus("");
    try {
      const response = await apiFetch("/api/flight-return-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departure_token: activeFlight.departure_token, snapshot_id: flight.snapshot_id, currency_code: currencyCode || "USD" }),
      });
      const payload = await parsePlanResponse(response) as {
        return_options?: FlightOption[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Could not load return flight options.");
      }
      const options = Array.isArray(payload.return_options) ? payload.return_options : [];
      setReturnOptions(options);
      setReturnStatus(
        options.length
          ? "Choose a return below."
          : "No return choices found. Open Google Flights to continue."
      );
      if (options.length === 1) {
        setActiveFlight(mergeFlightLegs(flight, options[0]));
        setSelectedReturnId(options[0].id);
      }
    } catch (caught) {
      setReturnStatus(caught instanceof Error ? caught.message : "Could not load return flight options.");
    } finally {
      setLoadingReturns(false);
    }
  };

  const selectReturnOption = (option: FlightOption) => {
    setActiveFlight(mergeFlightLegs(flight, option));
    setSelectedReturnId(option.id);
    setBookingOptions([]);
    setBookingStatus(option.booking_token ? "Return selected. Booking options are ready to load." : "Return selected, but no booking token was returned.");
  };

  return (
    <Modal label="Review round-trip flight" onClose={onClose}>
      <article
        className="max-h-[88vh] w-[min(94vw,920px)] overflow-auto rounded-[34px] border border-[#3fb6c4]/16 bg-[linear-gradient(145deg,rgba(22,22,22,0.97),rgba(6,6,6,0.96))] p-6 shadow-[0_34px_120px_rgba(0,0,0,0.62)] sm:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Flight Details</p>
            <h3 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-white sm:text-5xl">{formatFlightPrice(activeFlight)}</h3>
            <button type="button" className="action-button mt-3" disabled={!activeFlight.has_return_details} onClick={() => onSelect(activeFlight)}>{activeFlight.has_return_details ? "Choose this round trip" : "Choose a return first"}</button>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/66">
              <span className="rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.07] px-3 py-1.5">{formatFlightDuration(activeFlight.total_duration_minutes)}</span>
              <span className="rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.07] px-3 py-1.5">{getFlightAirlines(activeFlight)}</span>
              <span className="rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.07] px-3 py-1.5">
                {activeFlight.has_return_details ? "Return details included" : "Return selection may still be required"}
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/8 px-3 py-2 text-sm text-white/72 hover:bg-[#3fb6c4]/14">
            Close
          </button>
        </div>

        {!activeFlight.has_return_details ? (
          <div className="mb-5 rounded-[24px] border border-amber-200/18 bg-amber-200/[0.08] p-4">
            <p className="text-sm font-medium text-white">Return not selected</p>
            <p className="mt-1 text-sm text-white/62">Choose a return or continue on Google Flights.</p>
          </div>
        ) : null}

        <div className="grid gap-3">
          {(activeFlight.segments || []).map((segment, index) => (
            <div key={`${activeFlight.id}-modal-${index}`} className="rounded-[24px] border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.055] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-medium text-white">{segment.airline || "Airline"} {segment.flight_number || ""}</p>
                  <p className="mt-1 text-sm text-white/56">
                    {segment.from || "?"} to {segment.to || "?"} - {segment.depart_at || "departure TBD"}
                    {segment.arrive_at ? ` to ${segment.arrive_at}` : ""}
                  </p>
                </div>
                <span className="rounded-full border border-[#3fb6c4]/10 bg-[#0e1518]/30 px-3 py-1.5 text-xs text-white/58">
                  {formatFlightDuration(segment.duration_minutes)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/48">
                {segment.airplane ? <span className="rounded-full bg-[#0e1518]/30 px-3 py-1">{segment.airplane}</span> : null}
                {segment.travel_class ? <span className="rounded-full bg-[#0e1518]/30 px-3 py-1">{segment.travel_class}</span> : null}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={loadReturnOptions}
            disabled={loadingReturns || activeFlight.has_return_details || !activeFlight.departure_token}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.08] px-4 py-3 text-sm font-medium text-white/82 transition hover:bg-[#3fb6c4] hover:text-[#06181a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingReturns ? <Loader2 className="animate-spin" size={15} /> : <RotateCcw size={15} />}
            Select return flight
          </button>
          <button
            type="button"
            onClick={loadBookingOptions}
            disabled={loadingBookings || !activeFlight.booking_token}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#3fb6c4] px-4 py-3 text-sm font-medium text-[#06181a] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingBookings ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />}
            Load booking options
          </button>
          <a
            href={buildGoogleFlightsUrl(search)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.08] px-4 py-3 text-sm font-medium text-white/82 transition hover:bg-[#3fb6c4] hover:text-[#06181a]"
          >
            Open Google Flights <ExternalLink size={15} />
          </a>
        </div>


        {returnStatus ? <p className="mt-4 text-sm leading-relaxed text-white/58">{returnStatus}</p> : null}

        {returnOptions.length ? (
          <div className="mt-4 rounded-[26px] border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.04] p-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/44">Return flight options</p>
            <div className="mt-3 grid gap-3">
              {returnOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => selectReturnOption(option)}
                  className={`rounded-[22px] border p-4 text-left transition ${
                    selectedReturnId === option.id
                      ? "border-[#3fb6c4]/50 bg-[#3fb6c4]/[0.12]"
                      : "border-[#3fb6c4]/10 bg-[#0e1518]/24 hover:border-[#3fb6c4]/24 hover:bg-[#3fb6c4]/[0.08]"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-medium text-white">{getFlightAirlines(option)}</p>
                      <p className="mt-1 text-sm text-white/56">
                        {formatFlightDuration(option.total_duration_minutes)} - {formatFlightPrice(option)}
                      </p>
                    </div>
                    <span className="rounded-full border border-[#3fb6c4]/10 bg-[#0e1518]/30 px-3 py-1 text-xs text-white/58">
                      {option.booking_token ? "Provider continuation ready" : "Provider continuation unavailable"}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {(option.segments || []).map((segment, index) => (
                      <p key={`${option.id}-segment-${index}`} className="rounded-2xl border border-[#3fb6c4]/10 bg-[#0e1518]/24 px-3 py-2 text-sm text-white/58">
                        <span className="text-white/82">{segment.airline || "Airline"}</span> - {segment.from || "?"} to {segment.to || "?"} - {segment.depart_at || "departure TBD"}
                      </p>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {bookingStatus ? <p className="mt-4 text-sm leading-relaxed text-white/58">{bookingStatus}</p> : null}

        {bookingOptions.length ? (
          <div className="mt-4 grid gap-3">
            {bookingOptions.map((option) => (
              <article key={option.id} className="rounded-[22px] border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.055] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-medium text-white">{option.title}</p>
                    {option.description ? <p className="mt-1 text-sm leading-relaxed text-white/54">{option.description}</p> : null}
                  </div>
                  {option.price ? <span className="rounded-full bg-[#3fb6c4] px-3 py-1 text-xs font-semibold text-[#06181a]">{option.currency || activeFlight.currency || currencyCode} {option.price}</span> : null}
                </div>
                {option.extensions?.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {option.extensions.slice(0, 6).map((extension) => (
                      <span key={extension} className="rounded-full border border-[#3fb6c4]/10 bg-[#0e1518]/25 px-2.5 py-1 text-[11px] text-white/58">{extension}</span>
                    ))}
                  </div>
                ) : null}
                {option.link ? (
                  <a href={option.link} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.08] px-3 py-1.5 text-sm text-white/78 transition hover:bg-[#3fb6c4] hover:text-[#06181a]">
                    Continue to provider <ExternalLink size={13} />
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </article>
    </Modal>
  );
}
