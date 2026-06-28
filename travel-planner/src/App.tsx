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

type PlanJob = {
  id: string;
  status: "queued" | "collecting" | "planning" | "complete" | "failed";
  progress: string;
  options?: PlannerOptions;
  itinerary?: string;
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
  departure_token?: string | null;
  booking_token?: string | null;
  reference?: string | null;
  segments?: FlightSegment[];
  has_return_details?: boolean;
};

type FlightBookingOption = {
  id: string;
  title: string;
  price?: number | string | null;
  currency?: string | null;
  link?: string | null;
  description?: string | null;
  extensions?: string[];
};

type FlightRecoverySuggestion = {
  type: string;
  label: string;
  instruction: string;
};

type DayPlan = {
  day: string;
  title: string;
  summary: string;
  bullets: string[];
  details: string[];
};

type SavedTrip = {
  id: string;
  name: string;
  destination: string;
  dateRange: string;
  savedAt: string;
  form: PlannerForm;
  itinerary: string;
  options: PlannerOptions;
  resultTab: ResultTab;
};

type AuthUser = {
  id: number;
  name: string;
  email: string;
};

type AuthMode = "login" | "register";

type UserPreferences = {
  budget_style: string;
  travel_style: string;
  likes: string[];
  dislikes: string[];
  home_airport: string;
  preferred_currency: string;
  date_of_birth: string;
  age: number | null;
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

const STORAGE_KEY = "wanderful.currentTrip.v2";
const SAVED_TRIPS_KEY = "wanderful.savedTrips.v1";
const LEGACY_STORAGE_KEYS = ["wanderful.currentTrip"];

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoWrapRef = useRef<HTMLDivElement | null>(null);
  const presenceRef = useRef<HTMLDivElement | null>(null);
  const plannerRef = useRef<HTMLElement | null>(null);
  const [heroVisible, setHeroVisible] = useState(false);
  const [bottomVisible, setBottomVisible] = useState(false);
  const [form, setForm] = useState<PlannerForm>(initialForm);
  const [loading, setLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [jobProgress, setJobProgress] = useState("");
  const [error, setError] = useState("");
  const [itinerary, setItinerary] = useState("");
  const [options, setOptions] = useState<PlannerOptions>(emptyOptions);
  const [resultTab, setResultTab] = useState<ResultTab>("itinerary");
  const [hydrated, setHydrated] = useState(false);
  const [savedTrips, setSavedTrips] = useState<SavedTrip[]>([]);
  const [savedTripsOpen, setSavedTripsOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [profileOpen, setProfileOpen] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);

  useEffect(() => {
    setHeroVisible(true);
    const timer = window.setTimeout(() => setBottomVisible(true), 300);
    void refreshAuthUser();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    try {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
      const saved = window.localStorage.getItem(STORAGE_KEY);
      loadGuestSavedTrips();
      if (saved) {
        const parsed = JSON.parse(saved) as {
          form?: PlannerForm;
          itinerary?: string;
          options?: PlannerOptions;
          resultTab?: ResultTab;
        };
        if (parsed.form) {
          setForm({ ...initialForm, ...parsed.form });
        }
        if (parsed.itinerary) {
          setItinerary(parsed.itinerary);
        }
        if (parsed.options) {
          setOptions(normalizeOptions(parsed.options));
        }
        if (parsed.resultTab && ["itinerary", "hotels", "flights", "raw"].includes(parsed.resultTab)) {
          setResultTab(parsed.resultTab);
        }
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const payload = {
      form,
      itinerary,
      options,
      resultTab,
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [form, hydrated, itinerary, options, resultTab]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!authUser) {
      window.localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(savedTrips));
    }
  }, [authUser, hydrated, savedTrips]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (authUser) {
      void loadAccountWorkspace();
    } else {
      loadGuestSavedTrips();
      setPreferences(null);
    }
  }, [authUser, hydrated]);

  useEffect(() => {
    const videoBg = videoWrapRef.current;
    const presence = presenceRef.current;
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
      if (presence) {
        const distanceFromCenter = Math.min(1, Math.hypot(event.clientX - cx, event.clientY - cy) / Math.hypot(cx, cy));
        presence.style.setProperty("--cursor-x", `${event.clientX}px`);
        presence.style.setProperty("--cursor-y", `${event.clientY}px`);
        presence.style.setProperty("--presence", `${0.18 + distanceFromCenter * 0.2}`);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!presence) {
        return;
      }
      presence.style.setProperty("--cursor-x", `${event.clientX}px`);
      presence.style.setProperty("--cursor-y", `${event.clientY}px`);
      gsap.fromTo(
        presence,
        { "--pulse-size": "0px", "--pulse-opacity": 0.42 },
        { "--pulse-size": "420px", "--pulse-opacity": 0, duration: 0.75, ease: "power2.out" },
      );
      if (videoRef.current) {
        videoRef.current.playbackRate = 1.45;
        window.setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.playbackRate = 1.25;
          }
        }, 420);
      }
    };

    const animate = () => {
      currentX += (targetX - currentX) * 0.06;
      currentY += (targetY - currentY) * 0.06;
      gsap.set(videoBg, {
        x: currentX,
        y: currentY,
        filter: `brightness(${0.9 + Math.abs(currentX) / 420}) saturate(${1.02 + Math.abs(currentY) / 520})`,
      });
      frame = window.requestAnimationFrame(animate);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("pointerdown", handlePointerDown);
    frame = window.requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("pointerdown", handlePointerDown);
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
    setJobProgress("Starting trip planning job.");

    try {
      const response = await fetch("/api/plan-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await parsePlanResponse(response) as PlanResponse & { job_id?: string; job?: PlanJob };
      if (!response.ok) {
        throw new Error(payload.error || "Planner request failed.");
      }
      if (!payload.job_id) {
        throw new Error("Planner did not return a job id.");
      }
      await pollPlanJob(payload.job_id);
      setResultTab("itinerary");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Planner request failed.");
    } finally {
      setLoading(false);
      setJobProgress("");
    }
  };

  const pollPlanJob = async (jobId: string) => {
    const maxPolls = 240;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      await wait(attempt < 4 ? 900 : 1600);
      const response = await fetch(`/api/plan-jobs/${jobId}`);
      const payload = await parsePlanResponse(response) as PlanResponse & { job?: PlanJob };
      if (!response.ok || !payload.job) {
        throw new Error(payload.error || "Could not read planner job status.");
      }
      const job = payload.job;
      setJobProgress(job.progress || job.status);
      if (job.options) {
        setOptions(normalizeOptions(job.options));
      }
      if (job.status === "complete") {
        setItinerary(job.itinerary || "");
        return;
      }
      if (job.status === "failed") {
        throw new Error(job.error || "Planner job failed.");
      }
    }
    throw new Error("Planner job timed out. Try a shorter trip or check provider/LLM quotas.");
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
    setResultTab("itinerary");
    window.localStorage.removeItem(STORAGE_KEY);
  };

  const saveCurrentTrip = () => {
    if (!itinerary) {
      setError("Generate an itinerary before saving this trip.");
      return;
    }
    const tripName = `${form.destination || "Saved trip"} - ${formatDate(form.start_date)}`;
    const savedTrip: SavedTrip = {
      id: `${Date.now()}`,
      name: tripName,
      destination: form.destination || "Destination",
      dateRange: `${formatDate(form.start_date)} - ${formatDate(form.end_date)}`,
      savedAt: new Date().toISOString(),
      form,
      itinerary,
      options,
      resultTab,
    };
    if (authUser) {
      void saveAccountTrip(savedTrip);
    } else {
      setSavedTrips((current) => [savedTrip, ...current.filter((trip) => trip.name !== tripName)].slice(0, 20));
      setSavedTripsOpen(true);
    }
  };

  const loadSavedTrip = (trip: SavedTrip) => {
    setForm(trip.form);
    setItinerary(trip.itinerary);
    setOptions(normalizeOptions(trip.options));
    setResultTab(trip.resultTab || "itinerary");
    setError("");
    setSavedTripsOpen(false);
    plannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const deleteSavedTrip = (tripId: string) => {
    if (authUser) {
      void deleteAccountTrip(tripId);
      return;
    }
    setSavedTrips((current) => current.filter((trip) => trip.id !== tripId));
  };

  const loadGuestSavedTrips = () => {
    try {
      const savedTripsValue = window.localStorage.getItem(SAVED_TRIPS_KEY);
      if (savedTripsValue) {
        const parsedTrips = JSON.parse(savedTripsValue);
        setSavedTrips(Array.isArray(parsedTrips) ? parsedTrips : []);
      } else {
        setSavedTrips([]);
      }
    } catch {
      setSavedTrips([]);
    }
  };

  const loadAccountWorkspace = async () => {
    try {
      const [tripsResponse, preferencesResponse] = await Promise.all([
        fetch("/api/trips"),
        fetch("/api/preferences"),
      ]);
      if (tripsResponse.ok) {
        const payload = await parsePlanResponse(tripsResponse) as PlanResponse & { trips?: SavedTrip[] };
        setSavedTrips(Array.isArray(payload.trips) ? payload.trips : []);
      }
      if (preferencesResponse.ok) {
        const payload = await parsePlanResponse(preferencesResponse) as PlanResponse & { preferences?: UserPreferences };
        if (payload.preferences) {
          setPreferences(payload.preferences);
          applyPreferencesToForm(payload.preferences);
        }
      }
    } catch {
      setError("Could not load account workspace.");
    }
  };

  const saveAccountTrip = async (trip: SavedTrip) => {
    try {
      const response = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trip),
      });
      const payload = await parsePlanResponse(response) as PlanResponse & { trip?: SavedTrip };
      if (!response.ok || !payload.trip) {
        throw new Error(payload.error || "Could not save trip.");
      }
      setSavedTrips((current) => [payload.trip as SavedTrip, ...current].slice(0, 20));
      await savePreferencesFromCurrentTrip();
      setSavedTripsOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save trip.");
    }
  };

  const deleteAccountTrip = async (tripId: string) => {
    try {
      const response = await fetch(`/api/trips/${tripId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("Could not delete saved trip.");
      }
      setSavedTrips((current) => current.filter((trip) => trip.id !== tripId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete saved trip.");
    }
  };

  const savePreferencesFromCurrentTrip = async () => {
    if (!authUser) {
      return;
    }
    const nextPreferences: UserPreferences = {
      budget_style: inferBudgetStyle(form.budget),
      travel_style: preferences?.travel_style || "",
      likes: splitPreferenceList(form.interests),
      dislikes: preferences?.dislikes || [],
      home_airport: form.origin.toUpperCase(),
      preferred_currency: form.currency_code || "USD",
      date_of_birth: preferences?.date_of_birth || "",
      age: preferences?.age ?? null,
    };
    const response = await fetch("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextPreferences),
    });
    if (response.ok) {
      const payload = await parsePlanResponse(response) as PlanResponse & { preferences?: UserPreferences };
      if (payload.preferences) {
        setPreferences(payload.preferences);
      }
    }
  };

  const applyPreferencesToForm = (nextPreferences: UserPreferences | null) => {
    if (!nextPreferences) {
      return;
    }
    setForm((current) => ({
      ...current,
      origin: current.origin || nextPreferences.home_airport || current.origin,
      currency_code: current.currency_code || nextPreferences.preferred_currency || "USD",
      interests: current.interests || nextPreferences.likes.join(", "),
    }));
  };

  const refreshAuthUser = async () => {
    try {
      const response = await fetch("/api/auth/me");
      const payload = await parsePlanResponse(response) as PlanResponse & { user?: AuthUser | null };
      setAuthUser(payload.user || null);
    } catch {
      setAuthUser(null);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthUser(null);
    setPreferences(null);
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
      <div className="fixed inset-0 z-10 bg-black/48" />
      <div className="fixed inset-0 z-10 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.07),transparent_30%,rgba(0,0,0,0.76)_100%)]" />
      <div className="fixed inset-0 z-10 bg-[linear-gradient(180deg,rgba(0,0,0,0.62)_0%,rgba(0,0,0,0.18)_30%,rgba(0,0,0,0.26)_55%,rgba(0,0,0,0.78)_100%)]" />
      <div ref={presenceRef} className="hero-presence fixed inset-0 z-10 pointer-events-none" />

      <header className="fixed top-0 z-50 w-full px-4 py-4 text-white sm:px-8 sm:py-6">
        <div className="site-header-shell mx-auto flex max-w-7xl items-center justify-between gap-3 rounded-full px-3 py-2 sm:px-4">
          <a href="#" className="shrink-0 px-2 text-[17px] font-semibold tracking-tight">
            Wanderful<sup className="ml-0.5 text-[9px]">TM</sup>
          </a>

          <nav className="hidden items-center gap-1 lg:flex">
            {[
              ["Journey", "#planner"],
              ["Benefits", "#benefits"],
              ["Journal", "#journal"],
              ["Guidebook", "#guidebook"],
            ].map(([item, href]) => (
              <a
                key={item}
                href={href}
                className="rounded-full px-4 py-2 text-[11px] font-medium tracking-[0.12em] text-white/78 transition-colors duration-200 hover:bg-white/10 hover:text-white"
              >
                {item.toUpperCase()}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (authUser) {
                  setProfileOpen(true);
                  return;
                }
                setAuthMode("login");
                setAuthOpen(true);
              }}
              className="hidden rounded-full px-3 py-2 text-[10px] font-medium tracking-[0.12em] text-white/78 transition hover:bg-white/10 hover:text-white sm:block sm:text-[11px]"
            >
              {authUser ? `HI, ${authUser.name.split(" ")[0].toUpperCase()}` : "SIGN IN"}
            </button>

            <button
              type="button"
              onClick={() => setSavedTripsOpen(true)}
              className="hidden rounded-full px-3 py-2 text-[10px] font-medium tracking-[0.12em] text-white/78 transition hover:bg-white/10 hover:text-white md:block sm:text-[11px]"
            >
              SAVED TRIPS
            </button>

            <button
              type="button"
              onClick={scrollToPlanner}
              className="rounded-full bg-white px-4 py-2.5 text-[10px] font-semibold tracking-[0.12em] text-black transition hover:scale-[1.02] hover:shadow-[0_0_28px_rgba(255,255,255,0.18)] sm:px-5 sm:text-[11px]"
            >
              GET ROAMING
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-20 min-h-screen">
        <section className="relative flex min-h-screen flex-col items-center justify-between px-4 pb-14 pt-32 sm:pt-36">
          <div
            className={`relative z-20 w-[min(92vw,980px)] text-center transition-all duration-1000 ${
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
            className={`relative z-20 flex w-[min(92vw,720px)] flex-col items-center gap-6 text-center transition-all delay-300 duration-1000 ${
              bottomVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
            }`}
          >
            <p className="max-w-[620px] text-center text-[15px] leading-relaxed text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.55)]">
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
              SECURE BY DESIGN.
            </div>
          </div>
        </section>

        <section id="planner" ref={plannerRef} className="relative z-30 min-h-screen scroll-mt-28 px-4 py-24 sm:px-8 lg:px-10">
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

            <form onSubmit={submitPlan} className="planner-form-panel rounded-[32px] p-5 sm:p-7">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium tracking-[0.18em] text-white/55">START PLANNING</p>
                  <h3 className="mt-2 text-2xl font-medium text-white">Your escape details</h3>
                </div>
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-medium tracking-[0.12em] text-white/85">
                  SAVED LOCALLY
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
                  className="w-full resize-none rounded-3xl border border-white/18 bg-black/65 px-4 py-3 text-[15px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] outline-none transition placeholder:text-white/42 focus:border-white/45 focus:bg-black/75"
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
              {loading && jobProgress ? (
                <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.055] px-3 py-2 text-sm leading-relaxed text-white/62">
                  {jobProgress}
                </p>
              ) : null}

              {error && <div className="mt-4 rounded-3xl border border-red-300/20 bg-red-500/15 px-4 py-3 text-sm leading-relaxed text-red-50">{error}</div>}
            </form>
          </div>

          {(itinerary || hasAnyOptions(options)) && (
            <section className="liquid-glass mx-auto mt-6 max-w-6xl rounded-[32px] p-5 sm:p-7">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium tracking-[0.18em] text-white/55">{itinerary ? "FINAL ITINERARY" : "LIVE TRIP OPTIONS"}</p>
                  <h3 className="mt-2 text-2xl font-medium text-white">{itinerary ? "Your Wanderful plan" : "Provider data is ready"}</h3>
                </div>
                {itinerary ? <div className="flex gap-2">
                  <button onClick={copyItinerary} className="action-button" type="button"><Copy size={15} /> Copy</button>
                  <button onClick={saveCurrentTrip} className="action-button" type="button"><FileText size={15} /> Save</button>
                  <button onClick={downloadItinerary} className="action-button" type="button"><Download size={15} /> Download</button>
                  <button onClick={resetPlan} className="action-button" type="button"><RotateCcw size={15} /> New Trip</button>
                </div> : null}
              </div>
              <ItineraryResult
                form={form}
                itinerary={itinerary}
                options={options}
                onOptionsChange={setOptions}
                activeTab={resultTab}
                onTabChange={setResultTab}
              />
            </section>
          )}
        </section>

        <InfoSections />
      </main>

      <SavedTripsDrawer
        open={savedTripsOpen}
        trips={savedTrips}
        accountMode={Boolean(authUser)}
        onClose={() => setSavedTripsOpen(false)}
        onLoad={loadSavedTrip}
        onDelete={deleteSavedTrip}
        onNewTrip={resetPlan}
      />
      <AuthModal
        open={authOpen}
        mode={authMode}
        onModeChange={setAuthMode}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={(user) => {
          setAuthUser(user);
          setAuthOpen(false);
        }}
      />
      <ProfileModal
        open={profileOpen}
        user={authUser}
        preferences={preferences}
        savedTripCount={savedTrips.length}
        onPreferencesSaved={setPreferences}
        onClose={() => setProfileOpen(false)}
        onOpenSavedTrips={() => {
          setProfileOpen(false);
          setSavedTripsOpen(true);
        }}
        onLogout={() => {
          void logout();
          setProfileOpen(false);
        }}
      />
    </div>
  );
}

async function parsePlanResponse(response: Response): Promise<PlanResponse> {
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

function useEscapeToClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose]);
}

function InfoSections() {
  return (
    <section className="relative z-30 px-4 pb-24 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-6xl gap-5">
        <section id="benefits" className="scroll-mt-28 rounded-[32px] border border-white/12 bg-black/64 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.28)] sm:p-8">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">Benefits</p>
          <h3 className="mt-3 text-3xl font-medium tracking-[-0.04em] text-white sm:text-5xl">Planning that survives real-world changes.</h3>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <InfoCard title="Live provider data" text="Flights, hotels, weather, and local context are collected before the itinerary is written." />
            <InfoCard title="Interactive recovery" text="Change flight dates, airports, and retry searches without regenerating the whole trip." />
            <InfoCard title="Readable planning UI" text="Horizontal day cards, maps, hotel switching, saved trips, and raw Markdown export." />
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section id="journal" className="scroll-mt-28 rounded-[32px] border border-white/12 bg-black/58 p-6 sm:p-8">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">Journal</p>
            <h3 className="mt-3 text-3xl font-medium tracking-[-0.04em] text-white">What the planner remembers locally.</h3>
            <p className="mt-4 text-sm leading-relaxed text-white/62">
              Save trip workspaces in this browser, reopen previous itineraries, and keep exploring alternatives without losing your current plan.
            </p>
          </section>

          <section id="guidebook" className="scroll-mt-28 rounded-[32px] border border-white/12 bg-black/58 p-6 sm:p-8">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">Guidebook</p>
            <h3 className="mt-3 text-3xl font-medium tracking-[-0.04em] text-white">Built for the next AI systems layer.</h3>
            <p className="mt-4 text-sm leading-relaxed text-white/62">
              The architecture is ready for RAG guides, user preference memory, ranking models, saved cloud trips, and evaluation pipelines.
            </p>
          </section>
        </div>
      </div>
    </section>
  );
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.055] p-4">
      <p className="font-medium text-white">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-white/58">{text}</p>
    </div>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function AuthModal({
  open,
  mode,
  onModeChange,
  onClose,
  onAuthenticated,
}: {
  open: boolean;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
  onAuthenticated: (user: AuthUser) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEscapeToClose(open, onClose);

  if (!open) {
    return null;
  }

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`/api/auth/${mode === "register" ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const payload = await parsePlanResponse(response) as PlanResponse & { user?: AuthUser };
      if (!response.ok || !payload.user) {
        throw new Error(payload.error || "Authentication failed.");
      }
      onAuthenticated(payload.user);
      setName("");
      setEmail("");
      setPassword("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center bg-black/68 px-4 backdrop-blur-md" onClick={onClose}>
      <form
        onSubmit={submitAuth}
        className="w-[min(94vw,440px)] rounded-[32px] border border-white/16 bg-black/88 p-6 shadow-[0_34px_110px_rgba(0,0,0,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">Wanderful Account</p>
            <h3 className="mt-2 text-3xl font-medium tracking-[-0.04em] text-white">
              {mode === "register" ? "Create account" : "Welcome back"}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-white/12 bg-white/8 px-3 py-2 text-sm text-white/72 hover:bg-white/14">
            Close
          </button>
        </div>

        {mode === "register" ? (
          <AuthField label="Name" value={name} onChange={setName} autoComplete="name" />
        ) : null}
        <AuthField label="Email" value={email} onChange={setEmail} autoComplete="email" type="email" />
        <AuthField label="Password" value={password} onChange={setPassword} autoComplete={mode === "register" ? "new-password" : "current-password"} type="password" />

        {error ? <p className="mt-3 rounded-2xl border border-red-300/20 bg-red-500/16 px-3 py-2 text-sm text-red-50">{error}</p> : null}

        <button type="submit" disabled={loading} className="mt-5 w-full rounded-full bg-white px-4 py-3 text-sm font-medium text-black disabled:opacity-60">
          {loading ? "Working..." : mode === "register" ? "Create account" : "Sign in"}
        </button>

        <button
          type="button"
          onClick={() => onModeChange(mode === "register" ? "login" : "register")}
          className="mt-4 w-full text-sm text-white/62 hover:text-white"
        >
          {mode === "register" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </form>
    </div>
  );
}

function AuthField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.15em] text-white/52">{label}</span>
      <input
        required
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-2xl border border-white/16 bg-black/62 px-3 text-sm text-white outline-none transition focus:border-white/42"
      />
    </label>
  );
}

function ProfileModal({
  open,
  user,
  preferences,
  savedTripCount,
  onPreferencesSaved,
  onClose,
  onOpenSavedTrips,
  onLogout,
}: {
  open: boolean;
  user: AuthUser | null;
  preferences: UserPreferences | null;
  savedTripCount: number;
  onPreferencesSaved: (preferences: UserPreferences) => void;
  onClose: () => void;
  onOpenSavedTrips: () => void;
  onLogout: () => void;
}) {
  const [profileForm, setProfileForm] = useState({
    travel_style: "",
    budget_style: "",
    home_airport: "",
    preferred_currency: "USD",
    date_of_birth: "",
    age: "",
    likes: "",
    dislikes: "",
  });
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
  });
  const [profileStatus, setProfileStatus] = useState("");
  const [passwordStatus, setPasswordStatus] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  useEscapeToClose(open && Boolean(user), onClose);

  useEffect(() => {
    if (!open) {
      return;
    }
    setProfileForm({
      travel_style: preferences?.travel_style || "",
      budget_style: preferences?.budget_style || "",
      home_airport: preferences?.home_airport || "",
      preferred_currency: preferences?.preferred_currency || "USD",
      date_of_birth: preferences?.date_of_birth || "",
      age: preferences?.age ? String(preferences.age) : "",
      likes: preferences?.likes?.join(", ") || "",
      dislikes: preferences?.dislikes?.join(", ") || "",
    });
    setProfileStatus("");
    setPasswordStatus("");
  }, [open, preferences]);

  if (!open || !user) {
    return null;
  }

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingProfile(true);
    setProfileStatus("");
    try {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          travel_style: profileForm.travel_style,
          budget_style: profileForm.budget_style,
          home_airport: profileForm.home_airport,
          preferred_currency: profileForm.preferred_currency,
          date_of_birth: profileForm.date_of_birth,
          age: profileForm.age ? Number(profileForm.age) : null,
          likes: splitPreferenceList(profileForm.likes),
          dislikes: splitPreferenceList(profileForm.dislikes),
        }),
      });
      const payload = await parsePlanResponse(response) as PlanResponse & { preferences?: UserPreferences };
      if (!response.ok || !payload.preferences) {
        throw new Error(payload.error || "Could not save profile.");
      }
      onPreferencesSaved(payload.preferences);
      setProfileStatus("Profile settings saved.");
    } catch (caught) {
      setProfileStatus(caught instanceof Error ? caught.message : "Could not save profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingPassword(true);
    setPasswordStatus("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(passwordForm),
      });
      const payload = await parsePlanResponse(response) as PlanResponse & { ok?: boolean };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not change password.");
      }
      setPasswordForm({ current_password: "", new_password: "" });
      setPasswordStatus("Password changed.");
    } catch (caught) {
      setPasswordStatus(caught instanceof Error ? caught.message : "Could not change password.");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center bg-black/68 px-4 backdrop-blur-md" onClick={onClose}>
      <article
        className="max-h-[90vh] w-[min(94vw,860px)] overflow-auto rounded-[34px] border border-white/16 bg-[linear-gradient(145deg,rgba(20,20,20,0.96),rgba(5,5,5,0.94))] shadow-[0_34px_110px_rgba(0,0,0,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-white/10 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-white text-xl font-semibold text-black shadow-[0_0_38px_rgba(255,255,255,0.22)]">
                {user.name.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">My Profile</p>
                <h3 className="mt-1 text-3xl font-medium tracking-[-0.04em] text-white">{user.name}</h3>
                <p className="mt-1 text-sm text-white/54">{user.email}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-white/12 bg-white/8 px-3 py-2 text-sm text-white/72 hover:bg-white/14">
              Close
            </button>
          </div>
        </div>

        <div className="grid gap-4 p-6 sm:p-8">
          <form onSubmit={saveProfile} className="rounded-[28px] border border-white/10 bg-white/[0.045] p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/38">Profile settings</p>
                <p className="mt-1 text-lg font-medium text-white">Preference memory</p>
              </div>
              <button type="submit" disabled={savingProfile} className="rounded-full bg-white px-4 py-2.5 text-sm font-medium text-black disabled:opacity-60">
                {savingProfile ? "Saving..." : "Save profile"}
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ProfileInput label="Travel style" value={profileForm.travel_style} placeholder="adventure, luxury, slow travel" onChange={(value) => setProfileForm((current) => ({ ...current, travel_style: value }))} />
              <ProfileInput label="Budget style" value={profileForm.budget_style} placeholder="budget, mid-range, premium" onChange={(value) => setProfileForm((current) => ({ ...current, budget_style: value }))} />
              <ProfileInput label="Home airport" value={profileForm.home_airport} placeholder="LAX" onChange={(value) => setProfileForm((current) => ({ ...current, home_airport: value.toUpperCase() }))} />
              <ProfileInput label="Preferred currency" value={profileForm.preferred_currency} placeholder="USD" maxLength={3} onChange={(value) => setProfileForm((current) => ({ ...current, preferred_currency: value.toUpperCase() }))} />
              <ProfileInput type="date" label="Date of birth" value={profileForm.date_of_birth} onChange={(value) => setProfileForm((current) => ({ ...current, date_of_birth: value }))} />
              <ProfileInput type="number" label="Age" value={profileForm.age} placeholder="Optional" onChange={(value) => setProfileForm((current) => ({ ...current, age: value }))} />
              <ProfileInput label="Likes" value={profileForm.likes} placeholder="hiking, local food, beaches" onChange={(value) => setProfileForm((current) => ({ ...current, likes: value }))} />
              <ProfileInput label="Dislikes" value={profileForm.dislikes} placeholder="crowds, museums, red-eyes" onChange={(value) => setProfileForm((current) => ({ ...current, dislikes: value }))} />
            </div>
            {profileStatus ? <p className="mt-3 text-sm text-white/62">{profileStatus}</p> : null}
          </form>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <form onSubmit={changePassword} className="rounded-[24px] border border-white/10 bg-black/36 p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/38">Security</p>
              <p className="mt-1 text-lg font-medium text-white">Change password</p>
              <div className="mt-3 grid gap-3">
                <ProfileInput type="password" label="Current password" value={passwordForm.current_password} onChange={(value) => setPasswordForm((current) => ({ ...current, current_password: value }))} />
                <ProfileInput type="password" label="New password" value={passwordForm.new_password} onChange={(value) => setPasswordForm((current) => ({ ...current, new_password: value }))} />
              </div>
              <button type="submit" disabled={savingPassword} className="mt-3 rounded-full border border-white/12 bg-white/[0.08] px-4 py-2.5 text-sm font-medium text-white/78 hover:bg-white/14 disabled:opacity-60">
                {savingPassword ? "Updating..." : "Update password"}
              </button>
              {passwordStatus ? <p className="mt-3 text-sm text-white/62">{passwordStatus}</p> : null}
            </form>

            <div className="rounded-[24px] border border-white/10 bg-black/36 p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/38">Account workspace</p>
              <p className="mt-3 text-3xl font-medium text-white">{savedTripCount}</p>
              <p className="mt-1 text-sm text-white/54">saved trip{savedTripCount === 1 ? "" : "s"} in this account</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onOpenSavedTrips} className="rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:scale-[1.01]">
              Open saved trips
            </button>
            <button type="button" onClick={onLogout} className="rounded-full border border-white/12 bg-white/[0.055] px-5 py-3 text-sm font-medium text-white/72 transition hover:bg-white/12 hover:text-white">
              Log out
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function ProfileInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.15em] text-white/48">{label}</span>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-2xl border border-white/12 bg-black/52 px-3 text-sm text-white outline-none transition placeholder:text-white/32 focus:border-white/38"
      />
    </label>
  );
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
        className="h-12 w-full rounded-full border border-white/18 bg-black/65 px-4 text-[15px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] outline-none transition placeholder:text-white/42 focus:border-white/45 focus:bg-black/75"
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
  onOptionsChange,
  activeTab,
  onTabChange,
}: {
  form: PlannerForm;
  itinerary: string;
  options: PlannerOptions;
  onOptionsChange: (options: PlannerOptions) => void;
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
    <div className="overflow-hidden rounded-[28px] border border-white/14 bg-black/70 shadow-[0_24px_90px_rgba(0,0,0,0.32)]">
      <div className="border-b border-white/12 bg-black/55 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickFacts.map((fact) => (
            <div key={fact.label} className="rounded-3xl border border-white/12 bg-black/65 p-4">
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

          <div className="flex flex-wrap rounded-[22px] border border-white/12 bg-black/65 p-1">
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
        <div className="space-y-5 p-4 sm:p-5">
          {itinerary ? (
            <DayTimeline itinerary={itinerary} fallbackStartDate={form.start_date} fallbackEndDate={form.end_date} />
          ) : (
            <EmptyResult
              icon={<Loader2 className="animate-spin" size={18} />}
              title="Itinerary is being written"
              text="Flights, hotels, map data, and recovery controls are available in the other tabs while the LLM finishes the final plan."
            />
          )}

          {itinerary ? <article className="itinerary-markdown max-h-[620px] overflow-auto rounded-[26px] border border-white/12 bg-black/68 p-5 sm:p-7">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">Detailed Plan</p>
                <p className="mt-1 text-lg font-medium text-white">Full itinerary notes</p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/58">
                Markdown source preserved
              </span>
            </div>
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
          </article> : null}
        </div>
      ) : null}

      {activeTab === "hotels" ? (
        <HotelMapPanel
          form={form}
          hotels={options.hotels}
          mapCenter={options.map_center}
          onHotelsUpdated={(hotels, mapCenter) => onOptionsChange({ ...options, hotels, map_center: mapCenter })}
        />
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

function HotelMapPanel({
  form,
  hotels,
  mapCenter,
  onHotelsUpdated,
}: {
  form: PlannerForm;
  hotels: HotelOption[];
  mapCenter: Coordinates | null;
  onHotelsUpdated: (hotels: HotelOption[], mapCenter: Coordinates | null) => void;
}) {
  const [selectedHotelId, setSelectedHotelId] = useState(hotels[0]?.id || "");
  const [nightlyBudget, setNightlyBudget] = useState(() => inferInitialNightlyBudget(form));
  const [hotelStatus, setHotelStatus] = useState("");
  const [hotelLoading, setHotelLoading] = useState(false);
  const hotelsWithCoordinates = hotels.filter((hotel) => hotel.coordinates);
  const selectedHotel = hotels.find((hotel) => hotel.id === selectedHotelId) || hotels[0];
  const center = selectedHotel?.coordinates || mapCenter || hotelsWithCoordinates[0]?.coordinates || { lat: 39.5, lng: -98.35 };

  useEffect(() => {
    setSelectedHotelId(hotels[0]?.id || "");
  }, [hotels]);

  const refreshHotels = async () => {
    setHotelLoading(true);
    setHotelStatus("");
    try {
      const response = await fetch("/api/hotel-options", {
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
    } finally {
      setHotelLoading(false);
    }
  };

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
    <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[0.92fr_1.08fr]">
      <div className="max-h-[760px] space-y-3 overflow-auto pr-1">
        <div className="rounded-[28px] border border-white/12 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.16),transparent_34%),rgba(0,0,0,0.68)] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.28)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/50">Stay Finder</p>
              <h4 className="mt-1 text-2xl font-medium tracking-[-0.04em] text-white">Compare your base</h4>
              <p className="mt-2 text-sm leading-relaxed text-white/62">
                Pick a hotel to preview where it sits on the map. The AI itinerary remains unchanged for now.
              </p>
            </div>
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-black shadow-[0_0_38px_rgba(255,255,255,0.18)]">
              <Building2 size={20} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <StatPill label="Options" value={String(hotels.length)} />
            <StatPill label="Mapped" value={String(hotelsWithCoordinates.length)} />
            <StatPill label="Selected" value={selectedHotel?.nightly_rate || selectedHotel?.hotel_class || "Ready"} />
          </div>
          <div className="mt-5 rounded-[22px] border border-white/10 bg-black/35 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/42">Nightly Price Filter</p>
                <p className="mt-1 text-lg font-medium text-white">{form.currency_code || "USD"} {nightlyBudget}</p>
              </div>
              <button
                type="button"
                onClick={refreshHotels}
                disabled={hotelLoading}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:scale-[1.01] disabled:opacity-60"
              >
                {hotelLoading ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />}
                Search
              </button>
            </div>
            <input
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
            {hotelStatus ? <p className="mt-3 text-sm leading-relaxed text-white/56">{hotelStatus}</p> : null}
          </div>
        </div>
        {hotels.map((hotel) => (
          <article
            key={hotel.id}
            onClick={() => setSelectedHotelId(hotel.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                setSelectedHotelId(hotel.id);
              }
            }}
            role="button"
            tabIndex={0}
            className={`hotel-option-card group w-full cursor-pointer rounded-[26px] border p-4 text-left transition duration-300 focus:outline-none focus:ring-2 focus:ring-white/30 ${
              selectedHotel?.id === hotel.id
                ? "border-white/60 bg-white/[0.16]"
                : "border-white/12 bg-black/58 hover:border-white/28 hover:bg-white/[0.08]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                  {hotel.hotel_class || "Recommended stay"}
                </p>
                <p className="mt-1 text-lg font-medium leading-tight text-white">{hotel.name}</p>
              </div>
              {hotel.coordinates ? <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-black">Mapped</span> : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {hotel.nightly_rate ? <HotelMetric label="Night" value={hotel.nightly_rate} /> : null}
              {hotel.rating ? <HotelMetric label="Rating" value={`${hotel.rating}${hotel.reviews ? ` (${hotel.reviews})` : ""}`} /> : null}
              {hotel.estimated_total ? <HotelMetric label="Est. total" value={`${hotel.currency || ""} ${hotel.estimated_total}`} /> : null}
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
              <a
                href={hotel.link}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.08] px-3 py-1.5 text-sm text-white/78 transition hover:bg-white hover:text-black"
              >
                View hotel <ExternalLink size={12} />
              </a>
            ) : null}
          </article>
        ))}
      </div>

      <div className="hotel-map-shell relative overflow-hidden rounded-[34px] border border-white/14 bg-black/60 shadow-[0_32px_110px_rgba(0,0,0,0.44)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] h-28 bg-gradient-to-b from-black/70 to-transparent" />
        <div className="pointer-events-none absolute left-4 right-4 top-4 z-[501] flex flex-wrap items-start justify-between gap-3">
          <div className="rounded-2xl border border-white/12 bg-black/72 px-4 py-3 backdrop-blur-md">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">OpenStreetMap</p>
            <p className="mt-1 text-sm font-medium text-white">{hotelsWithCoordinates.length} mapped option{hotelsWithCoordinates.length === 1 ? "" : "s"}</p>
          </div>
          {selectedHotel ? (
            <div className="max-w-[320px] rounded-2xl border border-white/12 bg-black/72 px-4 py-3 text-right backdrop-blur-md">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">Selected Stay</p>
              <p className="mt-1 truncate text-sm font-medium text-white">{selectedHotel.name}</p>
              <p className="mt-1 text-xs text-white/55">{formatHotelMeta(selectedHotel)}</p>
            </div>
          ) : null}
        </div>
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

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/35 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-white/38">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function HotelMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.075] px-3 py-1.5 text-xs text-white/74">
      <span className="text-white/38">{label}</span> {value}
    </span>
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
    setInstruction("");
    setStatus("");
    setFlightSearch({
      origin: form.origin,
      destination: form.destination,
      start_date: form.start_date,
      end_date: form.end_date,
    });
  }, [flights, recovery, form.origin, form.destination, form.start_date, form.end_date]);

  const searchAlternates = async (nextInstruction: string, overrides = flightSearch) => {
    const cleaned = nextInstruction.trim();
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch("/api/flight-options", {
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
    <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <div className="rounded-[28px] border border-white/12 bg-[radial-gradient(circle_at_12%_0%,rgba(255,255,255,0.16),transparent_36%),rgba(0,0,0,0.68)] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.28)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/50">Flight Board</p>
              <h4 className="mt-1 text-2xl font-medium tracking-[-0.04em] text-white">
                {flightSearch.origin || "Origin"} to {flightSearch.destination || "Destination"}
              </h4>
              <p className="mt-2 text-sm leading-relaxed text-white/62">
                Compare available routes, copy SerpAPI booking tokens, or retry nearby dates and airports without rebuilding the whole trip.
              </p>
            </div>
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white text-black shadow-[0_0_38px_rgba(255,255,255,0.18)]">
              <Plane size={20} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatPill label="Options" value={String(currentFlights.length)} />
            <StatPill label="Depart" value={formatDate(flightSearch.start_date)} />
            <StatPill label="Return" value={formatDate(flightSearch.end_date)} />
            <StatPill label="Recovery" value={currentRecovery.length ? "Available" : "Clear"} />
          </div>
        </div>

        {currentFlights.length ? (
          currentFlights.map((flight, flightIndex) => (
            <article
              key={flight.id}
              onClick={() => setSelectedFlight(flight)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  setSelectedFlight(flight);
                }
              }}
              role="button"
              tabIndex={0}
              className="flight-option-card block w-full cursor-pointer rounded-[28px] border border-white/12 bg-black/70 p-5 text-left shadow-[0_20px_70px_rgba(0,0,0,0.28)] transition duration-300 hover:-translate-y-1 hover:border-white/28 focus:outline-none focus:ring-2 focus:ring-white/30"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Option {flightIndex + 1}</p>
                  <p className="mt-1 text-3xl font-medium tracking-[-0.05em] text-white">{formatFlightPrice(flight)}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/62">
                    <span className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5">{formatFlightDuration(flight.total_duration_minutes)}</span>
                    <span className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5">
                      {flight.has_return_details ? "Round-trip details found" : "Return details may be incomplete"}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5">{getFlightAirlines(flight)}</span>
                  </div>
                </div>
                {flight.booking_token ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void navigator.clipboard.writeText(flight.booking_token || "");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-[11px] text-white/76 transition hover:bg-white hover:text-black"
                  >
                    <Copy size={12} /> Copy token
                  </button>
                ) : null}
              </div>

              <div className="mt-5 space-y-3">
                {(flight.segments || []).map((segment, index) => (
                  <div key={`${flight.id}-${index}`} className="flight-segment-row rounded-[22px] border border-white/10 bg-white/[0.055] p-4">
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-black">
                        <Plane size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-white">{segment.airline || "Airline"}</p>
                          {segment.flight_number ? <span className="rounded-full bg-black/35 px-2 py-0.5 text-[11px] text-white/48">{segment.flight_number}</span> : null}
                        </div>
                        <p className="mt-1 text-sm text-white/54">
                          {segment.from || "?"} to {segment.to || "?"} - {segment.depart_at || "departure TBD"}
                          {segment.arrive_at ? ` to ${segment.arrive_at}` : ""}
                        </p>
                      </div>
                      <p className="hidden rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/52 sm:block">
                        {formatFlightDuration(segment.duration_minutes)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {flight.booking_token ? (
                <p className="mt-4 break-all rounded-2xl border border-white/10 bg-black/34 px-3 py-2 text-xs leading-relaxed text-white/48">
                  booking_token: {flight.booking_token}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                {flight.reference ? <p className="max-w-2xl text-xs leading-relaxed text-white/42">{flight.reference}</p> : <p className="text-xs text-white/42">Provider result normalized from SerpAPI Google Flights.</p>}
                <a
                  href={buildGoogleFlightsUrl(flightSearch)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.08] px-3 py-1.5 text-sm text-white/78 transition hover:bg-white hover:text-black"
                >
                  Open Google Flights <ExternalLink size={13} />
                </a>
              </div>
              <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.14em] text-white/40 transition group-hover:text-white/70">
                Click card for booking details
              </p>
            </article>
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
        <div className="rounded-[26px] border border-white/12 bg-black/68 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
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
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-medium text-black transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />}
            Check these flights
          </button>
          <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.055] px-3 py-2 text-xs leading-relaxed text-white/56">
            City names are converted to likely airport codes automatically, for example Los Angeles to LAX and San Jose to SJC.
          </p>
        </div>

        <div className="rounded-[26px] border border-white/12 bg-black/68 p-4 shadow-[0_18px_55px_rgba(0,0,0,0.2)]">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">Try another search</p>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={4}
            placeholder="Try leaving two days earlier, use SFO instead, or try nearby airports."
            className="mt-3 w-full resize-none rounded-2xl border border-white/16 bg-black/68 p-3 text-sm text-white outline-none placeholder:text-white/42 focus:border-white/42"
          />
          <button
            type="button"
            onClick={() => searchAlternates(instruction, flightSearch)}
            disabled={loading || !instruction.trim()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-medium text-black transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />}
            Search alternate flights
          </button>
          {status ? <p className="mt-3 text-sm leading-relaxed text-white/58">{status}</p> : null}
        </div>

        {currentRecovery.length ? (
          <div className="rounded-[26px] border border-white/12 bg-black/68 p-4 shadow-[0_18px_55px_rgba(0,0,0,0.2)]">
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
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.055] px-3 py-2 text-left text-sm leading-relaxed text-white/72 transition hover:border-white/24 hover:bg-white/[0.11] hover:text-white"
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
      />
    </div>
  );
}

function FlightDetailModal({
  flight,
  currencyCode,
  search,
  onClose,
}: {
  flight: FlightOption | null;
  currencyCode: string;
  search: { origin: string; destination: string; start_date: string; end_date: string };
  onClose: () => void;
}) {
  const [bookingOptions, setBookingOptions] = useState<FlightBookingOption[]>([]);
  const [returnOptions, setReturnOptions] = useState<FlightOption[]>([]);
  const [activeFlight, setActiveFlight] = useState<FlightOption | null>(flight);
  const [bookingStatus, setBookingStatus] = useState("");
  const [returnStatus, setReturnStatus] = useState("");
  const [selectedReturnId, setSelectedReturnId] = useState("");
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [loadingReturns, setLoadingReturns] = useState(false);
  useEscapeToClose(Boolean(flight), onClose);

  useEffect(() => {
    if (flight) {
      setActiveFlight(flight);
    }
    setBookingOptions([]);
    setBookingStatus("");
    setReturnOptions([]);
    setReturnStatus("");
    setSelectedReturnId("");
  }, [flight?.id]);

  if (!flight || !activeFlight) {
    return null;
  }

  const loadBookingOptions = async () => {
    if (!activeFlight.booking_token) {
      setBookingStatus("This flight result did not include a booking token. Open Google Flights to continue.");
      return;
    }
    setLoadingBookings(true);
    setBookingStatus("");
    try {
      const response = await fetch("/api/flight-booking-options", {
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
          ? "Booking options loaded from SerpAPI."
          : "SerpAPI did not return direct booking links for this token. Open Google Flights to continue."
      );
    } catch (caught) {
      setBookingStatus(caught instanceof Error ? caught.message : "Could not load booking options.");
    } finally {
      setLoadingBookings(false);
    }
  };

  const loadReturnOptions = async () => {
    if (!activeFlight.departure_token) {
      setReturnStatus("This flight result did not include a departure token. Open Google Flights to choose the return leg.");
      return;
    }
    setLoadingReturns(true);
    setReturnStatus("");
    setBookingOptions([]);
    setBookingStatus("");
    try {
      const response = await fetch("/api/flight-return-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departure_token: activeFlight.departure_token, currency_code: currencyCode || "USD" }),
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
          ? "Choose a return option below, then load booking options."
          : "SerpAPI did not return return-flight choices for this token. Open Google Flights to continue."
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
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 px-4 backdrop-blur-md" onClick={onClose}>
      <article
        className="max-h-[88vh] w-[min(94vw,920px)] overflow-auto rounded-[34px] border border-white/16 bg-[linear-gradient(145deg,rgba(22,22,22,0.97),rgba(6,6,6,0.96))] p-6 shadow-[0_34px_120px_rgba(0,0,0,0.62)] sm:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Flight Details</p>
            <h3 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-white sm:text-5xl">{formatFlightPrice(activeFlight)}</h3>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/66">
              <span className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5">{formatFlightDuration(activeFlight.total_duration_minutes)}</span>
              <span className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5">{getFlightAirlines(activeFlight)}</span>
              <span className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5">
                {activeFlight.has_return_details ? "Return details included" : "Return selection may still be required"}
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-white/12 bg-white/8 px-3 py-2 text-sm text-white/72 hover:bg-white/14">
            Close
          </button>
        </div>

        {!activeFlight.has_return_details ? (
          <div className="mb-5 rounded-[24px] border border-amber-200/18 bg-amber-200/[0.08] p-4">
            <p className="text-sm font-medium text-white">Return details may be incomplete</p>
            <p className="mt-2 text-sm leading-relaxed text-white/62">
              Google Flights sometimes returns the outbound leg first and provides a departure token for selecting return flights. This app keeps the result visible, but final verification should happen in Google Flights or a booking provider before purchase.
            </p>
            {activeFlight.departure_token ? (
              <p className="mt-3 break-all rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/48">
                departure_token: {activeFlight.departure_token}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3">
          {(activeFlight.segments || []).map((segment, index) => (
            <div key={`${activeFlight.id}-modal-${index}`} className="rounded-[24px] border border-white/10 bg-white/[0.055] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-medium text-white">{segment.airline || "Airline"} {segment.flight_number || ""}</p>
                  <p className="mt-1 text-sm text-white/56">
                    {segment.from || "?"} to {segment.to || "?"} - {segment.depart_at || "departure TBD"}
                    {segment.arrive_at ? ` to ${segment.arrive_at}` : ""}
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white/58">
                  {formatFlightDuration(segment.duration_minutes)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/48">
                {segment.airplane ? <span className="rounded-full bg-black/30 px-3 py-1">{segment.airplane}</span> : null}
                {segment.travel_class ? <span className="rounded-full bg-black/30 px-3 py-1">{segment.travel_class}</span> : null}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={loadReturnOptions}
            disabled={loadingReturns || activeFlight.has_return_details || !activeFlight.departure_token}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.08] px-4 py-3 text-sm font-medium text-white/82 transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingReturns ? <Loader2 className="animate-spin" size={15} /> : <RotateCcw size={15} />}
            Select return flight
          </button>
          <button
            type="button"
            onClick={loadBookingOptions}
            disabled={loadingBookings || !activeFlight.booking_token}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-medium text-black transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingBookings ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />}
            Load booking options
          </button>
          <a
            href={buildGoogleFlightsUrl(search)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.08] px-4 py-3 text-sm font-medium text-white/82 transition hover:bg-white hover:text-black"
          >
            Open Google Flights <ExternalLink size={15} />
          </a>
        </div>

        {activeFlight.booking_token ? (
          <p className="mt-4 break-all rounded-2xl border border-white/10 bg-black/34 px-3 py-2 text-xs leading-relaxed text-white/48">
            booking_token: {activeFlight.booking_token}
          </p>
        ) : null}

        {returnStatus ? <p className="mt-4 text-sm leading-relaxed text-white/58">{returnStatus}</p> : null}

        {returnOptions.length ? (
          <div className="mt-4 rounded-[26px] border border-white/10 bg-white/[0.04] p-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/44">Return flight options</p>
            <div className="mt-3 grid gap-3">
              {returnOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => selectReturnOption(option)}
                  className={`rounded-[22px] border p-4 text-left transition ${
                    selectedReturnId === option.id
                      ? "border-white/50 bg-white/[0.12]"
                      : "border-white/10 bg-black/24 hover:border-white/24 hover:bg-white/[0.08]"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-medium text-white">{getFlightAirlines(option)}</p>
                      <p className="mt-1 text-sm text-white/56">
                        {formatFlightDuration(option.total_duration_minutes)} - {formatFlightPrice(option)}
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/58">
                      {option.booking_token ? "Booking token ready" : "No booking token"}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {(option.segments || []).map((segment, index) => (
                      <p key={`${option.id}-segment-${index}`} className="rounded-2xl border border-white/10 bg-black/24 px-3 py-2 text-sm text-white/58">
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
              <article key={option.id} className="rounded-[22px] border border-white/10 bg-white/[0.055] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-medium text-white">{option.title}</p>
                    {option.description ? <p className="mt-1 text-sm leading-relaxed text-white/54">{option.description}</p> : null}
                  </div>
                  {option.price ? <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">{option.currency || activeFlight.currency || currencyCode} {option.price}</span> : null}
                </div>
                {option.extensions?.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {option.extensions.slice(0, 6).map((extension) => (
                      <span key={extension} className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-white/58">{extension}</span>
                    ))}
                  </div>
                ) : null}
                {option.link ? (
                  <a href={option.link} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.08] px-3 py-1.5 text-sm text-white/78 transition hover:bg-white hover:text-black">
                    Continue to provider <ExternalLink size={13} />
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </article>
    </div>
  );
}

function EmptyResult({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[26px] border border-white/12 bg-black/62 p-8 text-center">
      <div className="mb-3 rounded-full border border-white/10 bg-white/[0.07] p-3 text-white/68">{icon}</div>
      <p className="text-lg font-medium text-white">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-white/55">{text}</p>
    </div>
  );
}

function SavedTripsDrawer({
  open,
  trips,
  accountMode,
  onClose,
  onLoad,
  onDelete,
  onNewTrip,
}: {
  open: boolean;
  trips: SavedTrip[];
  accountMode: boolean;
  onClose: () => void;
  onLoad: (trip: SavedTrip) => void;
  onDelete: (tripId: string) => void;
  onNewTrip: () => void;
}) {
  useEscapeToClose(open, onClose);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/58 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="absolute right-0 top-0 h-full w-[min(94vw,430px)] overflow-auto border-l border-white/12 bg-black/88 p-5 shadow-[-28px_0_90px_rgba(0,0,0,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/48">Saved workspace</p>
            <h3 className="mt-1 text-3xl font-medium tracking-[-0.04em] text-white">Saved trips</h3>
            <p className="mt-2 text-sm text-white/52">
              {accountMode ? "Saved to your Wanderful account." : "Guest trips are saved in this browser only."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-white/12 bg-white/8 px-3 py-2 text-sm text-white/72 hover:bg-white/14">
            Close
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            onNewTrip();
            onClose();
          }}
          className="mb-4 w-full rounded-full bg-white px-4 py-3 text-sm font-medium text-black transition hover:scale-[1.01]"
        >
          Start a new trip
        </button>

        {trips.length ? (
          <div className="space-y-3">
            {trips.map((trip) => (
              <article key={trip.id} className="rounded-[24px] border border-white/12 bg-white/[0.055] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-medium leading-tight text-white">{trip.name}</h4>
                    <p className="mt-1 text-sm text-white/56">{trip.destination} - {trip.dateRange}</p>
                    <p className="mt-2 text-xs text-white/38">Saved {formatSavedAt(trip.savedAt)}</p>
                  </div>
                  <MapPin className="mt-1 shrink-0 text-white/42" size={18} />
                </div>
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => onLoad(trip)} className="flex-1 rounded-full bg-white px-3 py-2 text-sm font-medium text-black">
                    Open
                  </button>
                  <button type="button" onClick={() => onDelete(trip.id)} className="rounded-full border border-white/12 bg-black/35 px-3 py-2 text-sm text-white/68 hover:bg-white/10">
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyResult
            icon={<FileText size={18} />}
            title="No saved trips yet"
            text="Generate an itinerary, click Save, and it will appear here. Saved trips stay in this browser."
          />
        )}
      </aside>
    </div>
  );
}

function splitPreferenceList(value: string) {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function inferBudgetStyle(value: string) {
  const budget = Number(value);
  if (!Number.isFinite(budget)) {
    return "";
  }
  if (budget < 1200) {
    return "budget";
  }
  if (budget < 3500) {
    return "mid-range";
  }
  return "premium";
}

function inferInitialNightlyBudget(form: PlannerForm) {
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

function DayTimeline({
  itinerary,
  fallbackStartDate,
  fallbackEndDate,
}: {
  itinerary: string;
  fallbackStartDate: string;
  fallbackEndDate: string;
}) {
  const days = extractDayPlans(itinerary, fallbackStartDate, fallbackEndDate);
  const [selectedDay, setSelectedDay] = useState<DayPlan | null>(null);

  if (!days.length) {
    return (
      <div className="rounded-[28px] border border-white/12 bg-black/62 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">Day Planner</p>
            <p className="mt-1 text-2xl font-medium tracking-[-0.03em] text-white">Horizontal itinerary</p>
          </div>
          <CalendarDays className="text-white/50" size={20} />
        </div>
        <p className="text-sm leading-relaxed text-white/58">
          The generated itinerary did not expose clear Day 1 / Day 2 sections, so the full itinerary is shown below.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.09),rgba(255,255,255,0.025))] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.28)]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">Day-by-day flow</p>
          <h4 className="mt-1 text-2xl font-medium tracking-[-0.035em] text-white sm:text-3xl">
            Your trip at a glance
          </h4>
        </div>
        <div className="rounded-full border border-white/10 bg-black/35 px-3 py-1.5 text-[11px] font-medium text-white/62">
          Swipe horizontally
        </div>
      </div>

      <div className="day-timeline-scroll flex gap-4 overflow-x-auto pb-3">
        {days.map((day, index) => (
          <button
            key={`${day.day}-${index}`}
            type="button"
            onClick={() => setSelectedDay(day)}
            className="day-card group min-w-[280px] max-w-[320px] flex-1 rounded-[28px] border border-white/12 bg-black/48 p-4 text-left transition duration-300 hover:-translate-y-1 hover:border-white/30 hover:bg-black/62"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">{day.day}</p>
                <h5 className="mt-2 text-xl font-medium leading-tight tracking-[-0.03em] text-white">
                  {day.title}
                </h5>
              </div>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-sm font-semibold text-black shadow-[0_0_30px_rgba(255,255,255,0.22)]">
                {index + 1}
              </div>
            </div>

            {day.summary ? <p className="mb-4 line-clamp-3 text-sm leading-relaxed text-white/58">{day.summary}</p> : null}

            <div className="space-y-2">
              {day.bullets.slice(0, 4).map((bullet, bulletIndex) => (
                <div key={`${day.day}-bullet-${bulletIndex}`} className="rounded-2xl border border-white/10 bg-black/44 px-3 py-2 text-sm leading-relaxed text-white/76">
                  {bullet}
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.14em] text-white/40 transition group-hover:text-white/70">
              Click for details
            </p>
          </button>
        ))}
      </div>

      <DayDetailModal day={selectedDay} onClose={() => setSelectedDay(null)} />
    </section>
  );
}

function DayDetailModal({ day, onClose }: { day: DayPlan | null; onClose: () => void }) {
  useEscapeToClose(Boolean(day), onClose);

  if (!day) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/68 px-4 backdrop-blur-md" onClick={onClose}>
      <article
        className="max-h-[86vh] w-[min(94vw,760px)] overflow-auto rounded-[34px] border border-white/16 bg-[linear-gradient(145deg,rgba(22,22,22,0.96),rgba(6,6,6,0.94))] p-6 shadow-[0_34px_110px_rgba(0,0,0,0.55)] sm:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">{day.day}</p>
            <h3 className="mt-2 text-3xl font-medium leading-tight tracking-[-0.04em] text-white sm:text-5xl">{day.title}</h3>
            {day.summary ? <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/62">{day.summary}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-white/12 bg-white/8 px-3 py-2 text-sm text-white/72 hover:bg-white/14">
            Close
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(day.details.length ? day.details : day.bullets).slice(0, 12).map((detail, index) => (
            <div key={`${day.day}-detail-${index}`} className="rounded-[22px] border border-white/10 bg-white/[0.055] p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/38">Stop {index + 1}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/76">{detail}</p>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

function FlightControlField({
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
        className="h-11 w-full rounded-2xl border border-white/14 bg-black/60 px-3 text-sm text-white outline-none transition placeholder:text-white/34 focus:border-white/38 focus:bg-black/75"
      />
    </label>
  );
}

function ResultPill({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-[24px] border border-white/12 bg-black/58 p-4 shadow-[0_16px_48px_rgba(0,0,0,0.18)]">
      <div className="flex items-center gap-2 text-white/70">
        {icon}
        <p className="text-[10px] font-medium uppercase tracking-[0.16em]">{title}</p>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-white/58">{text}</p>
    </div>
  );
}

function extractDayPlans(markdown: string, fallbackStartDate: string, fallbackEndDate: string): DayPlan[] {
  const lines = markdown.split(/\r?\n/);
  const headingPattern = /^\s{0,3}(?:#{1,5}\s*)?(?:[-*]\s*)?(?:\*\*)?\s*(?:[^\w\s]{0,4}\s*)?(day\s+\d+)\s*(?:[:\-|)]\s*)?(.*?)(?:\*\*)?\s*$/i;
  const parentheticalPattern = /^\s{0,3}(?:#{1,5}\s*)?(?:[-*]\s*)?(?:\*\*)?\s*(.*?)\s*\((day\s+\d+)\)\s*(?:[:\-|]\s*)?(.*?)(?:\*\*)?\s*$/i;
  const dateHeadingPattern = /^\s{0,3}(?:#{1,5}\s*)?(?:[-*]\s*)?(?:\*\*)?\s*((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2})\s*(?:[:\-|)]\s*)?(.*?)(?:\*\*)?\s*$/i;
  const sections: Array<{ heading: string; title: string; lines: string[] }> = [];
  let current: { heading: string; title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const match = line.match(headingPattern) || line.match(parentheticalPattern);
    if (match) {
      if (current) {
        sections.push(current);
      }
      const parenthetical = match.length > 3 && /day\s+\d+/i.test(match[2] || "");
      current = {
        heading: normalizeDayLabel(parenthetical ? match[2] : match[1]),
        title: cleanMarkdownText(parenthetical ? `${match[1]} ${match[3] || ""}` : match[2]) || dateForDay(fallbackStartDate, sections.length),
        lines: [],
      };
      continue;
    }
    const dateMatch = line.match(dateHeadingPattern);
    if (dateMatch) {
      if (current) {
        sections.push(current);
      }
      current = {
        heading: `Day ${sections.length + 1}`,
        title: cleanMarkdownText(`${dateMatch[1]} ${dateMatch[2] || ""}`) || dateForDay(fallbackStartDate, sections.length),
        lines: [],
      };
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push(current);
  }

  const parsed = sections.slice(0, 14).map((section) => {
    const cleanLines = section.lines
      .map(cleanMarkdownText)
      .filter((line) => line && !/^#{1,6}\s/.test(line));
    const bullets = cleanLines
      .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || /morning|afternoon|evening|breakfast|lunch|dinner|hotel|flight/i.test(line))
      .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""))
      .slice(0, 6);
    const summary = cleanLines.find((line) => !/^[-*]\s+/.test(line) && !/^\d+\.\s+/.test(line)) || bullets[0] || "";

    return {
      day: section.heading,
      title: section.title || "Planned day",
      summary,
      bullets: bullets.length ? bullets : cleanLines.slice(0, 4),
      details: cleanLines
        .filter((line) => line.length > 3)
        .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""))
        .slice(0, 16),
    };
  });
  return parsed.length ? parsed : buildFallbackDayPlans(markdown, fallbackStartDate, fallbackEndDate);
}

function buildFallbackDayPlans(markdown: string, fallbackStartDate: string, fallbackEndDate: string): DayPlan[] {
  const dayCount = getTripDayCount(fallbackStartDate, fallbackEndDate);
  if (!dayCount) {
    return [];
  }
  const candidates = markdown
    .split(/\r?\n/)
    .map(cleanMarkdownText)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""))
    .filter((line) => {
      if (line.length < 8 || /^#{1,6}\s/.test(line)) {
        return false;
      }
      return /morning|afternoon|evening|breakfast|lunch|dinner|visit|explore|hotel|flight|arrive|depart|activity|restaurant|beach|museum|tour|walk|drive|check/i.test(line);
    })
    .slice(0, Math.max(dayCount * 5, dayCount));
  if (!candidates.length) {
    return [];
  }
  const chunkSize = Math.max(1, Math.ceil(candidates.length / dayCount));
  return Array.from({ length: dayCount }, (_, index) => {
    const details = candidates.slice(index * chunkSize, index * chunkSize + chunkSize);
    return {
      day: `Day ${index + 1}`,
      title: dateForDay(fallbackStartDate, index),
      summary: details[0] || "Planned day",
      bullets: details.slice(0, 5),
      details: details.slice(0, 12),
    };
  }).filter((day) => day.details.length);
}

function cleanMarkdownText(value: string) {
  return value
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/^\s*>+\s?/, "")
    .trim();
}

function normalizeDayLabel(value: string) {
  return value.replace(/\s+/g, " ").replace(/\bday\b/i, "Day");
}

function dateForDay(startDate: string, index: number) {
  if (!startDate) {
    return "Planned day";
  }
  const date = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "Planned day";
  }
  date.setDate(date.getDate() + index);
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function getTripDayCount(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 0;
  }
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.min(14, Math.max(1, Math.round((end.getTime() - start.getTime()) / dayMs) + 1));
}

function normalizeOptions(options?: PlannerOptions): PlannerOptions {
  return {
    hotels: Array.isArray(options?.hotels) ? options.hotels : [],
    flights: Array.isArray(options?.flights) ? options.flights : [],
    flight_recovery: Array.isArray(options?.flight_recovery) ? options.flight_recovery : [],
    map_center: options?.map_center || null,
  };
}

function hasAnyOptions(options: PlannerOptions) {
  return Boolean(options.hotels.length || options.flights.length || options.flight_recovery.length || options.map_center);
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
  return parts.length ? parts.join(" - ") : "Hotel details available";
}

function formatFlightPrice(flight: FlightOption) {
  if (flight.total_price) {
    return `${flight.currency || "USD"} ${flight.total_price}`;
  }
  return "Price unavailable";
}

function formatFlightDuration(minutes?: number | null) {
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

function getFlightAirlines(flight: FlightOption) {
  const airlines = Array.from(
    new Set((flight.segments || []).map((segment) => segment.airline).filter(Boolean) as string[])
  );
  return airlines.length ? airlines.slice(0, 3).join(", ") : "Airline TBD";
}

function mergeFlightLegs(outbound: FlightOption, returnOption: FlightOption): FlightOption {
  return {
    ...outbound,
    ...returnOption,
    id: `${outbound.id}-${returnOption.id}`,
    segments: [...(outbound.segments || []), ...(returnOption.segments || [])],
    total_price: returnOption.total_price ?? outbound.total_price,
    currency: returnOption.currency || outbound.currency,
    booking_token: returnOption.booking_token || outbound.booking_token,
    departure_token: returnOption.departure_token || outbound.departure_token,
    has_return_details: true,
    reference: returnOption.reference || outbound.reference,
  };
}

function buildGoogleFlightsUrl(search: { origin: string; destination: string; start_date: string; end_date: string }) {
  const query = `${search.origin} to ${search.destination} ${search.start_date} ${search.end_date}`.trim();
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`;
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

function formatSavedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "recently";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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
