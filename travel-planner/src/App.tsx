import { FormEvent, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown, Building2, CalendarDays, Clock, Copy, Download, ExternalLink, FileText, ListChecks, Loader2, Lock, MapPin, Plane, RotateCcw, Search, Sparkles, Users, Wallet } from "lucide-react";
import gsap from "gsap";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "leaflet/dist/leaflet.css";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260510_060007_60275ce7-030c-4668-a160-8f364ec537d3.mp4";

type PlannerForm = {
  origin: string;
  destination: string;
  start_date: string;
  end_date: string;
  budget: string;
  currency_code: string;
  adults: string;
  interests: string;
};

type PlanResponse = {
  itinerary?: string;
  options?: PlannerOptions;
  error?: string;
};

type ResultTab = "itinerary" | "hotels" | "flights" | "raw";

type PlannerOptions = {
  hotels: HotelOption[];
  flights: FlightOption[];
  flight_recovery: FlightRecoverySuggestion[];
  map_center: Coordinates | null;
};

type Coordinates = {
  lat: number;
  lng: number;
};

type HotelOption = {
  id: string;
  name: string;
  description?: string | null;
  hotel_class?: string | null;
  rating?: number | string | null;
  reviews?: number | string | null;
  nightly_rate?: string | null;
  extracted_nightly_rate?: number | null;
  estimated_total?: number | null;
  currency?: string | null;
  amenities?: string[];
  link?: string | null;
  coordinates?: Coordinates | null;
};

type FlightSegment = {
  airline?: string | null;
  flight_number?: string | null;
  from?: string | null;
  to?: string | null;
  depart_at?: string | null;
  arrive_at?: string | null;
  airplane?: string | null;
  travel_class?: string | null;
  duration_minutes?: number | null;
};

type FlightOption = {
  id: string;
  total_price?: number | string | null;
  currency?: string | null;
  total_duration_minutes?: number | null;
  layovers?: unknown[];
  booking_token?: string | null;
  reference?: string | null;
  segments?: FlightSegment[];
  has_return_details?: boolean;
};

type FlightRecoverySuggestion = {
  type: string;
  label: string;
  instruction: string;
};

const initialForm: PlannerForm = {
  origin: "",
  destination: "",
  start_date: "",
  end_date: "",
  budget: "",
  currency_code: "USD",
  adults: "1",
  interests: "",
};

const emptyOptions: PlannerOptions = {
  hotels: [],
  flights: [],
  flight_recovery: [],
  map_center: null,
};

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

const loadingMessages = [
  "Collecting live flight, hotel, weather, and local context.",
  "Coordinating specialist agents around your travel rhythm.",
  "Checking budget pressure and fallback provider behavior.",
  "Polishing your itinerary into a structured Markdown plan.",
];

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoWrapRef = useRef<HTMLDivElement | null>(null);
  const plannerRef = useRef<HTMLElement | null>(null);
  const [heroVisible, setHeroVisible] = useState(false);
  const [bottomVisible, setBottomVisible] = useState(false);
  const [form, setForm] = useState<PlannerForm>(initialForm);
  const [loading, setLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [error, setError] = useState("");
  const [itinerary, setItinerary] = useState("");
  const [options, setOptions] = useState<PlannerOptions>(emptyOptions);
  const [resultTab, setResultTab] = useState<ResultTab>("itinerary");

  useEffect(() => {
    setHeroVisible(true);
    const timer = window.setTimeout(() => setBottomVisible(true), 300);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const videoBg = videoWrapRef.current;
    if (!videoBg) {
      return undefined;
    }

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let frame = 0;

    const handleMove = (event: MouseEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      targetX = ((event.clientX - cx) / cx) * 20;
      targetY = ((event.clientY - cy) / cy) * 20;
    };

    const animate = () => {
      currentX += (targetX - currentX) * 0.06;
      currentY += (targetY - currentY) * 0.06;
      gsap.set(videoBg, { x: currentX, y: currentY });
      frame = window.requestAnimationFrame(animate);
    };

    window.addEventListener("mousemove", handleMove);
    frame = window.requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setLoadingMessageIndex((current) => (current + 1) % loadingMessages.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const updateField = (field: keyof PlannerForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const scrollToPlanner = () => {
    plannerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      videoRef.current.playbackRate = 1.25;
    }
  };

  const submitPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setItinerary("");
    setOptions(emptyOptions);
    setLoadingMessageIndex(0);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await parsePlanResponse(response);
      if (!response.ok) {
        throw new Error(payload.error || "Planner request failed.");
      }
      setItinerary(payload.itinerary || "");
      setOptions(normalizeOptions(payload.options));
      setResultTab("itinerary");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Planner request failed.");
    } finally {
      setLoading(false);
    }
  };

  const copyItinerary = async () => {
    if (itinerary) {
      await navigator.clipboard.writeText(itinerary);
    }
  };

  const downloadItinerary = () => {
    const blob = new Blob([itinerary], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "wanderful-itinerary.md";
    link.click();
    URL.revokeObjectURL(url);
  };

  const resetPlan = () => {
    setError("");
    setItinerary("");
    setOptions(emptyOptions);
    setForm(initialForm);
  };

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div ref={videoWrapRef} className="fixed inset-0 z-0 origin-center scale-[1.08]">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          src={VIDEO_URL}
          autoPlay
          muted
          loop
          playsInline
          onLoadedMetadata={handleLoadedMetadata}
        />
      </div>
      <div className="fixed inset-0 z-10 bg-black/35" />
      <div className="fixed inset-0 z-10 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),transparent_34%,rgba(0,0,0,0.62)_100%)]" />

      <header className="fixed top-0 z-50 flex w-full items-center justify-between px-5 py-6 text-white sm:px-10 sm:py-8">
        <a href="#" className="text-[17px] font-semibold tracking-tight">
          Wanderful<sup className="ml-0.5 text-[9px]">TM</sup>
        </a>

        <nav className="liquid-glass hidden items-center gap-1 rounded-full px-2 py-2 md:flex">
          {["JOURNEY", "BENEFITS", "JOURNAL", "GUIDEBOOK"].map((item) => (
            <a
              key={item}
              href="#planner"
              className="rounded-full px-4 py-1.5 text-[11px] font-medium tracking-[0.12em] text-white/90 transition-colors duration-200 hover:text-white"
            >
              {item}
            </a>
          ))}
        </nav>

        <button
          type="button"
          onClick={scrollToPlanner}
          className="liquid-glass rounded-full px-4 py-2.5 text-[10px] font-medium tracking-[0.12em] text-white/90 transition-colors hover:text-white sm:px-5 sm:text-[11px]"
        >
          GET ROAMING
        </button>
      </header>

      <main className="relative z-20 min-h-screen">
        <section className="relative min-h-screen">
          <div
            className={`fixed left-1/2 top-[120px] z-20 w-[min(92vw,980px)] -translate-x-1/2 text-center transition-all duration-1000 ${
              heroVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
            }`}
          >
            <h1 className="font-inter text-[clamp(40px,5.4vw,72px)] font-normal leading-[1.1] tracking-[-0.02em] text-white">
              Venture without edges.
            </h1>
            <h2 className="font-inter text-[clamp(40px,5.4vw,72px)] font-normal leading-[1.1] tracking-[-0.02em] text-[rgba(255,255,255,0.55)]">
              Uncover with keen instinct.
            </h2>
          </div>

          <div
            className={`fixed bottom-14 left-1/2 z-20 flex w-[min(92vw,720px)] -translate-x-1/2 flex-col items-center gap-6 text-center transition-all delay-300 duration-1000 ${
              bottomVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
            }`}
          >
            <p className="max-w-[620px] text-center text-[15px] leading-relaxed text-white">
              Our smart itineraries shape around you - your rhythm, your vibe, your hunger for adventure.
              <span className="text-white/55"> Each getaway is tailored, seamless, and wholly yours.</span>
            </p>
            <button
              type="button"
              onClick={scrollToPlanner}
              className="rounded-full bg-white px-8 py-3.5 text-[15px] font-medium text-black transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_0_32px_4px_rgba(255,255,255,0.2)] active:scale-[0.97]"
            >
              Plan my escape today
            </button>
            <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.14em] text-white/70">
              <Lock size={13} strokeWidth={1.5} />
              SECURE BY DESIGN. ZERO DATA LEAKS.
            </div>
          </div>
        </section>

        <section id="planner" ref={plannerRef} className="relative z-30 min-h-screen px-4 py-24 sm:px-8 lg:px-10">
          <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="liquid-glass rounded-[32px] p-6 sm:p-8">
              <div className="mb-8 flex items-start justify-between gap-6">
                <div>
                  <p className="text-[11px] font-medium tracking-[0.18em] text-white/55">AI TRIP BRIEF</p>
                  <h3 className="mt-3 text-3xl font-medium tracking-[-0.03em] text-white sm:text-5xl">
                    Shape the trip. Let agents handle the details.
                  </h3>
                </div>
                <Sparkles className="mt-1 shrink-0 text-white/60" size={24} strokeWidth={1.4} />
              </div>

              <div className="grid gap-3 text-sm text-white/72">
                <InfoRow icon={<Plane size={16} strokeWidth={1.5} />} title="Live route intelligence" text="Flights, hotels, weather, and local search flow through the backend API." />
                <InfoRow icon={<CalendarDays size={16} strokeWidth={1.5} />} title="Date-aware planning" text="Past dates are blocked before providers can fail." />
                <InfoRow icon={<Lock size={16} strokeWidth={1.5} />} title="Fallback ready" text="Gemini can hand off to Groq when quota gets tight." />
              </div>
            </div>

            <form onSubmit={submitPlan} className="liquid-glass rounded-[32px] p-5 sm:p-7">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium tracking-[0.18em] text-white/55">START PLANNING</p>
                  <h3 className="mt-2 text-2xl font-medium text-white">Your escape details</h3>
                </div>
                <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-medium tracking-[0.12em] text-white/75">
                  GEMINI/GROQ + SERPAPI
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Origin" value={form.origin} placeholder="LAX" onChange={(value) => updateField("origin", value)} />
                <Field label="Destination" value={form.destination} placeholder="HNL or Hawaii" onChange={(value) => updateField("destination", value)} />
                <Field type="date" label="Start date" value={form.start_date} onChange={(value) => updateField("start_date", value)} />
                <Field type="date" label="End date" value={form.end_date} onChange={(value) => updateField("end_date", value)} />
                <Field label="Budget" value={form.budget} placeholder="2500" onChange={(value) => updateField("budget", value)} />
                <div className="grid grid-cols-[1fr_1fr] gap-4">
                  <Field label="Currency" value={form.currency_code} maxLength={3} onChange={(value) => updateField("currency_code", value.toUpperCase())} />
                  <Field type="number" label="Adults" value={form.adults} min="1" max="9" onChange={(value) => updateField("adults", value)} />
                </div>
              </div>

              <label className="mt-4 block">
                <span className="mb-2 block text-[11px] font-medium tracking-[0.15em] text-white/55">INTERESTS</span>
                <textarea
                  required
                  rows={4}
                  value={form.interests}
                  onChange={(event) => updateField("interests", event.target.value)}
                  placeholder="quiet beaches, local food, hiking, scenic drives"
                  className="w-full resize-none rounded-3xl border border-white/10 bg-black/25 px-4 py-3 text-[15px] text-white outline-none transition focus:border-white/30 focus:bg-black/35"
                />
              </label>

              <button
                type="submit"
                disabled={loading}
                className="mt-5 flex w-full items-center justify-center gap-3 rounded-full bg-white px-8 py-4 text-[15px] font-medium text-black transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_0_32px_4px_rgba(255,255,255,0.18)] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <ArrowDown size={18} />}
                {loading ? loadingMessages[loadingMessageIndex] : "Generate my Wanderful itinerary"}
              </button>

              {error && <div className="mt-4 rounded-3xl border border-red-300/20 bg-red-500/15 px-4 py-3 text-sm leading-relaxed text-red-50">{error}</div>}
            </form>
          </div>

          {itinerary && (
            <section className="liquid-glass mx-auto mt-6 max-w-6xl rounded-[32px] p-5 sm:p-7">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium tracking-[0.18em] text-white/55">FINAL ITINERARY</p>
                  <h3 className="mt-2 text-2xl font-medium text-white">Your Wanderful plan</h3>
                </div>
                <div className="flex gap-2">
                  <button onClick={copyItinerary} className="action-button" type="button"><Copy size={15} /> Copy</button>
                  <button onClick={downloadItinerary} className="action-button" type="button"><Download size={15} /> Download</button>
                  <button onClick={resetPlan} className="action-button" type="button"><RotateCcw size={15} /> Reset</button>
                </div>
              </div>
              <ItineraryResult
                form={form}
                itinerary={itinerary}
                options={options}
                activeTab={resultTab}
                onTabChange={setResultTab}
              />
            </section>
          )}
        </section>
      </main>
    </div>
  );
}

async function parsePlanResponse(response: Response): Promise<PlanResponse> {
  const text = await response.text();
  if (!text.trim()) {
    return {
      error: `Planner API returned an empty response with status ${response.status}. Check that Flask is running and Vite is proxying to the correct port.`,
    };
  }

  try {
    return JSON.parse(text) as PlanResponse;
  } catch {
    return {
      error: `Planner API returned non-JSON response with status ${response.status}: ${text.slice(0, 240)}`,
    };
  }
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  min,
  max,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  min?: string;
  max?: string;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-medium tracking-[0.15em] text-white/55">{label.toUpperCase()}</span>
      <input
        required
        type={type}
        value={value}
        min={min}
        max={max}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-full border border-white/10 bg-black/25 px-4 text-[15px] text-white outline-none transition placeholder:text-white/28 focus:border-white/30 focus:bg-black/35"
      />
    </label>
  );
}

function InfoRow({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-3xl border border-white/10 bg-white/[0.035] p-4">
      <div className="mt-0.5 text-white/65">{icon}</div>
      <div>
        <p className="font-medium text-white">{title}</p>
        <p className="mt-1 leading-relaxed text-white/55">{text}</p>
      </div>
    </div>
  );
}

function ItineraryResult({
  form,
  itinerary,
  options,
  activeTab,
  onTabChange,
}: {
  form: PlannerForm;
  itinerary: string;
  options: PlannerOptions;
  activeTab: ResultTab;
  onTabChange: (tab: ResultTab) => void;
}) {
  const tripLength = getTripLengthLabel(form.start_date, form.end_date);
  const quickFacts = [
    { icon: <MapPin size={16} />, label: "Route", value: `${form.origin || "Origin"} to ${form.destination || "Destination"}` },
    { icon: <CalendarDays size={16} />, label: "Dates", value: `${formatDate(form.start_date)} - ${formatDate(form.end_date)}` },
    { icon: <Wallet size={16} />, label: "Budget", value: `${form.currency_code || "USD"} ${form.budget || "0"}` },
    { icon: <Users size={16} />, label: "Travelers", value: `${form.adults || "1"} adult${form.adults === "1" ? "" : "s"}` },
  ];

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-black/35">
      <div className="border-b border-white/10 bg-white/[0.035] p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickFacts.map((fact) => (
            <div key={fact.label} className="rounded-3xl border border-white/10 bg-black/25 p-4">
              <div className="flex items-center gap-2 text-white/55">
                {fact.icon}
                <span className="text-[10px] font-medium uppercase tracking-[0.16em]">{fact.label}</span>
              </div>
              <p className="mt-2 text-[15px] font-medium text-white">{fact.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/60">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">
              <Clock size={13} /> {tripLength}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5">
              <Sparkles size={13} /> {form.interests || "Custom interests"}
            </span>
          </div>

          <div className="flex flex-wrap rounded-[22px] border border-white/10 bg-black/30 p-1">
            {[
              ["itinerary", "Itinerary"],
              ["hotels", "Hotels Map"],
              ["flights", "Flights"],
              ["raw", "Raw Markdown"],
            ].map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => onTabChange(tab as ResultTab)}
                className={`rounded-full px-4 py-2 text-[12px] font-medium transition ${
                  activeTab === tab ? "bg-white text-black" : "text-white/68 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTab === "itinerary" ? (
        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-3">
            <ResultPill icon={<ListChecks size={15} />} title="Best for" text={form.interests || "Your selected travel style"} />
            <ResultPill icon={<Plane size={15} />} title="Live data" text="Flights, hotels, weather, and local search summarized by agents" />
            <ResultPill icon={<FileText size={15} />} title="Format" text="Readable cards with booking links preserved" />
          </aside>

          <article className="itinerary-markdown max-h-[720px] overflow-auto rounded-[26px] border border-white/10 bg-black/30 p-5 sm:p-7">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ children, href }) => (
                  <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-white hover:bg-white/16">
                    {children}
                    <ExternalLink size={12} />
                  </a>
                ),
              }}
            >
              {itinerary}
            </ReactMarkdown>
          </article>
        </div>
      ) : null}

      {activeTab === "hotels" ? (
        <HotelMapPanel hotels={options.hotels} mapCenter={options.map_center} />
      ) : null}

      {activeTab === "flights" ? (
        <FlightOptionsPanel form={form} flights={options.flights} recovery={options.flight_recovery} />
      ) : null}

      {activeTab === "raw" ? (
        <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap p-5 font-barlow text-[15px] leading-7 text-white/82 sm:p-7">
          {itinerary}
        </pre>
      ) : null}
    </div>
  );
}

function HotelMapPanel({ hotels, mapCenter }: { hotels: HotelOption[]; mapCenter: Coordinates | null }) {
  const [selectedHotelId, setSelectedHotelId] = useState(hotels[0]?.id || "");
  const hotelsWithCoordinates = hotels.filter((hotel) => hotel.coordinates);
  const selectedHotel = hotels.find((hotel) => hotel.id === selectedHotelId) || hotels[0];
  const center = selectedHotel?.coordinates || mapCenter || hotelsWithCoordinates[0]?.coordinates || { lat: 39.5, lng: -98.35 };

  useEffect(() => {
    setSelectedHotelId(hotels[0]?.id || "");
  }, [hotels]);

  if (!hotels.length) {
    return (
      <EmptyResult
        icon={<Building2 size={18} />}
        title="No hotel options available"
        text="The hotel provider did not return structured hotel options for this trip. Try a broader destination, higher budget, or different dates."
      />
    );
  }

  return (
    <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="max-h-[720px] space-y-3 overflow-auto pr-1">
        <p className="rounded-3xl border border-white/10 bg-white/[0.045] px-4 py-3 text-sm leading-relaxed text-white/62">
          Switch hotels here to compare locations and prices. This changes the selected option in the UI only; the written itinerary stays as generated.
        </p>
        {hotels.map((hotel) => (
          <button
            key={hotel.id}
            type="button"
            onClick={() => setSelectedHotelId(hotel.id)}
            className={`w-full rounded-[24px] border p-4 text-left transition ${
              selectedHotel?.id === hotel.id
                ? "border-white/45 bg-white/[0.12]"
                : "border-white/10 bg-white/[0.045] hover:bg-white/[0.075]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-medium text-white">{hotel.name}</p>
                <p className="mt-1 text-sm text-white/55">
                  {formatHotelMeta(hotel)}
                </p>
              </div>
              {hotel.coordinates ? <MapPin className="shrink-0 text-white/68" size={17} /> : null}
            </div>
            {hotel.description ? <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-white/58">{hotel.description}</p> : null}
            {hotel.amenities?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {hotel.amenities.slice(0, 5).map((amenity) => (
                  <span key={amenity} className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/62">
                    {amenity}
                  </span>
                ))}
              </div>
            ) : null}
            {hotel.link ? (
              <a href={hotel.link} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-white hover:underline">
                View hotel <ExternalLink size={12} />
              </a>
            ) : null}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-[26px] border border-white/10 bg-black/30">
        {hotelsWithCoordinates.length ? (
          <MapContainer center={[center.lat, center.lng]} zoom={12} scrollWheelZoom className="hotel-map">
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
                  eventHandlers={{ click: () => setSelectedHotelId(hotel.id) }}
                >
                  <Popup>
                    <strong>{hotel.name}</strong>
                    <br />
                    {formatHotelMeta(hotel)}
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        ) : (
          <EmptyResult
            icon={<MapPin size={18} />}
            title="Map unavailable for these hotel results"
            text="SerpAPI did not include coordinates for the returned hotels. The cards are still available, and no paid geocoding API was called."
          />
        )}
      </div>
    </div>
  );
}

function MapRecenter({ center }: { center: Coordinates }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], map.getZoom(), { animate: true });
  }, [center, map]);
  return null;
}

function FlightOptionsPanel({
  form,
  flights,
  recovery,
}: {
  form: PlannerForm;
  flights: FlightOption[];
  recovery: FlightRecoverySuggestion[];
}) {
  const [instruction, setInstruction] = useState("");
  const [currentFlights, setCurrentFlights] = useState(flights);
  const [currentRecovery, setCurrentRecovery] = useState(recovery);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCurrentFlights(flights);
    setCurrentRecovery(recovery);
    setInstruction("");
    setStatus("");
  }, [flights, recovery]);

  const searchAlternates = async (nextInstruction: string) => {
    const cleaned = nextInstruction.trim();
    if (!cleaned) {
      return;
    }
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch("/api/flight-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, instruction: cleaned }),
      });
      const payload = await parsePlanResponse(response) as PlanResponse & {
        flights?: FlightOption[];
        recovery_suggestions?: FlightRecoverySuggestion[];
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Flight search failed.");
      }
      setCurrentFlights(payload.flights || []);
      setCurrentRecovery(payload.recovery_suggestions || []);
      setStatus(payload.message || "Updated flight options.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Flight search failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        {currentFlights.length ? (
          currentFlights.map((flight) => (
            <div key={flight.id} className="rounded-[24px] border border-white/10 bg-white/[0.045] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-medium text-white">{formatFlightPrice(flight)}</p>
                  <p className="mt-1 text-sm text-white/55">
                    {flight.total_duration_minutes ? `${Math.round(flight.total_duration_minutes / 60)}h total` : "Duration unavailable"}
                    {flight.has_return_details ? " · Round-trip details detected" : " · Return details may be incomplete"}
                  </p>
                </div>
                {flight.booking_token ? (
                  <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[11px] text-white/62">Booking token</span>
                ) : null}
              </div>
              <div className="mt-4 space-y-2">
                {(flight.segments || []).map((segment, index) => (
                  <div key={`${flight.id}-${index}`} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/65">
                    <span className="font-medium text-white">{segment.airline || "Airline"}</span>
                    {" · "}
                    {segment.from || "?"} to {segment.to || "?"}
                    {" · "}
                    {segment.depart_at || "departure TBD"}
                  </div>
                ))}
              </div>
              {flight.reference ? <p className="mt-3 text-xs leading-relaxed text-white/42">{flight.reference}</p> : null}
            </div>
          ))
        ) : (
          <EmptyResult
            icon={<Plane size={18} />}
            title="No flight options returned"
            text="Use the recovery suggestions or type a sentence to try nearby dates, nearby airports, or a different city."
          />
        )}
      </div>

      <aside className="space-y-3">
        <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">Try another search</p>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={4}
            placeholder="Try leaving two days earlier, use SFO instead, or try nearby airports."
            className="mt-3 w-full resize-none rounded-2xl border border-white/10 bg-black/25 p-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/30"
          />
          <button
            type="button"
            onClick={() => searchAlternates(instruction)}
            disabled={loading || !instruction.trim()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-medium text-black transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />}
            Search alternate flights
          </button>
          {status ? <p className="mt-3 text-sm leading-relaxed text-white/58">{status}</p> : null}
        </div>

        {currentRecovery.length ? (
          <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">Suggestions</p>
            <div className="mt-3 space-y-2">
              {currentRecovery.map((suggestion) => (
                <button
                  key={`${suggestion.type}-${suggestion.instruction}`}
                  type="button"
                  onClick={() => {
                    setInstruction(suggestion.instruction);
                    void searchAlternates(suggestion.instruction);
                  }}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-left text-sm leading-relaxed text-white/68 transition hover:bg-white/[0.08] hover:text-white"
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function EmptyResult({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[26px] border border-white/10 bg-black/25 p-8 text-center">
      <div className="mb-3 rounded-full border border-white/10 bg-white/[0.07] p-3 text-white/68">{icon}</div>
      <p className="text-lg font-medium text-white">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-white/55">{text}</p>
    </div>
  );
}

function ResultPill({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-4">
      <div className="flex items-center gap-2 text-white/70">
        {icon}
        <p className="text-[10px] font-medium uppercase tracking-[0.16em]">{title}</p>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-white/58">{text}</p>
    </div>
  );
}

function normalizeOptions(options?: PlannerOptions): PlannerOptions {
  return {
    hotels: Array.isArray(options?.hotels) ? options.hotels : [],
    flights: Array.isArray(options?.flights) ? options.flights : [],
    flight_recovery: Array.isArray(options?.flight_recovery) ? options.flight_recovery : [],
    map_center: options?.map_center || null,
  };
}

function formatHotelMeta(hotel: HotelOption) {
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
  return parts.length ? parts.join(" · ") : "Hotel details available";
}

function formatFlightPrice(flight: FlightOption) {
  if (flight.total_price) {
    return `${flight.currency || "USD"} ${flight.total_price}`;
  }
  return "Price unavailable";
}

function formatDate(value: string) {
  if (!value) {
    return "TBD";
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function getTripLengthLabel(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return "Trip length ready after dates are set";
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / dayMs) + 1);
  const nights = Math.max(0, days - 1);
  return `${days} day${days === 1 ? "" : "s"} / ${nights} night${nights === 1 ? "" : "s"}`;
}

export default App;
