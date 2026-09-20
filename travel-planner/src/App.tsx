import { FormEvent, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowRight, BookOpen, Bookmark, Braces, Building2, CalendarDays, Check, CircleUserRound, Clock, Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, Compass, Copy, Download, ExternalLink, FileText, ListChecks, Loader2, Lock, MapPin, Plane, RotateCcw, Route, Search, Share2, Sparkles, Sun, Users, Wallet } from "lucide-react";
import gsap from "gsap";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "leaflet/dist/leaflet.css";
import { apiFetch } from "./api/client";
import { AdminPanel } from "./features/admin/AdminPanel";
import { PasswordResetModal } from "./features/auth/PasswordResetModal";
import { GuidebookPanel } from "./features/guidebook/GuidebookPanel";
import { JobHistoryPanel } from "./features/jobs/JobHistoryPanel";
import { JournalPanel } from "./features/journal/JournalPanel";
import { TripIntelligencePanel } from "./features/intelligence/TripIntelligencePanel";
import { InfoSections } from "./features/marketing/InfoSections";
import type {
  AuthMode,
  AuthUser,
  Coordinates,
  DayPlan,
  FlightBookingOption,
  FlightOption,
  FlightRecoverySuggestion,
  HotelOption,
  PlannerForm,
  PlannerOptions,
  PlanJob,
  PlanResponse,
  PriceInsights,
  ResultTab,
  SavedTrip,
  StructuredActivityData,
  StructuredDayData,
  StructuredItineraryData,
  UserPreferences,
  WeatherInfo,
} from "./domain/travel";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260510_060007_60275ce7-030c-4668-a160-8f364ec537d3.mp4";

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
  price_insights: null,
  weather: null,
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
  const [structuredItinerary, setStructuredItinerary] = useState<StructuredItineraryData | null>(null);
  const [activePlanJobId, setActivePlanJobId] = useState<string | null>(null);
  const [regeneratingDay, setRegeneratingDay] = useState<number | null>(null);
  const [options, setOptions] = useState<PlannerOptions>(emptyOptions);
  const [resultTab, setResultTab] = useState<ResultTab>("itinerary");
  const [hydrated, setHydrated] = useState(false);
  const [savedTrips, setSavedTrips] = useState<SavedTrip[]>([]);
  const [savedTripsOpen, setSavedTripsOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [profileOpen, setProfileOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(
    () => new URLSearchParams(window.location.search).get("admin_panel") === "1",
  );
  const [jobHistoryOpen, setJobHistoryOpen] = useState(false);
  const [journalTrip, setJournalTrip] = useState<SavedTrip | null>(null);
  const [guidebookTrip, setGuidebookTrip] = useState<SavedTrip | null>(null);
  const [intelligenceTrip, setIntelligenceTrip] = useState<SavedTrip | null>(null);
  const [passwordResetToken, setPasswordResetToken] = useState(
    () => new URLSearchParams(window.location.search).get("reset_token") || "",
  );
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);

  useEffect(() => {
    setHeroVisible(true);
    const timer = window.setTimeout(() => setBottomVisible(true), 300);
    void refreshAuthUser();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("admin_panel") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
    }
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
          structuredItinerary?: StructuredItineraryData;
          options?: PlannerOptions;
          resultTab?: ResultTab;
          activePlanJobId?: string | null;
        };
        if (parsed.form) {
          setForm({ ...initialForm, ...parsed.form });
        }
        if (parsed.itinerary) {
          setItinerary(parsed.itinerary);
        }
        if (parsed.structuredItinerary) {
          setStructuredItinerary(parsed.structuredItinerary);
        }
        if (parsed.options) {
          setOptions(normalizeOptions(parsed.options));
        }
        if (parsed.resultTab && ["itinerary", "hotels", "flights", "raw"].includes(parsed.resultTab)) {
          setResultTab(parsed.resultTab);
        }
        if (parsed.activePlanJobId) {
          setActivePlanJobId(parsed.activePlanJobId);
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
      structuredItinerary,
      options,
      resultTab,
      activePlanJobId,
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [activePlanJobId, form, hydrated, itinerary, options, resultTab, structuredItinerary]);

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
    setStructuredItinerary(null);
    setActivePlanJobId(null);
    setOptions(emptyOptions);
    setLoadingMessageIndex(0);
    setJobProgress("Starting trip planning job.");

    try {
      const response = await apiFetch("/api/plan-jobs", {
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

  const applyCompletedJob = (job: PlanJob) => {
    if (job.options) {
      setOptions(normalizeOptions(job.options));
    }
    setItinerary(job.itinerary || "");
    setStructuredItinerary(job.structured_itinerary || null);
    setActivePlanJobId(job.id);
  };

  const pollPlanJob = async (jobId: string) => {
    const maxPolls = 240;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      await wait(attempt < 4 ? 900 : 1600);
      const response = await apiFetch(`/api/plan-jobs/${jobId}`);
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
        applyCompletedJob(job);
        return;
      }
      if (job.status === "failed") {
        throw new Error(job.error || "Planner job failed.");
      }
      if (job.status === "cancelled") {
        throw new Error(job.progress || "Planning was cancelled.");
      }
    }
    throw new Error("Planner job timed out. Try a shorter trip or check provider/LLM quotas.");
  };

  const persistPlanJobLocks = async (locks: { locked_hotel_id?: string; locked_flight_id?: string }) => {
    if (!activePlanJobId) {
      return;
    }
    try {
      const response = await apiFetch(`/api/plan-jobs/${activePlanJobId}/locks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(locks),
      });
      const payload = (await parsePlanResponse(response)) as PlanResponse & { job?: PlanJob };
      if (response.ok && payload.job?.structured_itinerary) {
        setStructuredItinerary(payload.job.structured_itinerary);
      }
    } catch {
      // The lock still applies locally for this session even if persistence fails.
    }
  };

  const pollDayRegeneration = async (jobId: string) => {
    const maxPolls = 60;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      await wait(attempt < 4 ? 900 : 1600);
      const response = await apiFetch(`/api/plan-jobs/${jobId}`);
      const payload = (await parsePlanResponse(response)) as PlanResponse & { job?: PlanJob };
      if (!response.ok || !payload.job) {
        throw new Error(payload.error || "Could not read planner job status.");
      }
      const job = payload.job;
      if (job.status === "regenerating") {
        continue;
      }
      setStructuredItinerary(job.structured_itinerary || null);
      setItinerary(job.itinerary || "");
      if (job.error) {
        throw new Error(job.error);
      }
      return;
    }
    throw new Error("Day regeneration timed out.");
  };

  useEffect(() => {
    if (!hydrated || !authUser) {
      return;
    }
    const jobId = new URLSearchParams(window.location.search).get("job_id");
    if (!jobId) {
      return;
    }
    window.history.replaceState({}, "", window.location.pathname);
    (async () => {
      try {
        const response = await apiFetch(`/api/plan-jobs/${jobId}`);
        const payload = (await parsePlanResponse(response)) as PlanResponse & { job?: PlanJob };
        if (response.ok && payload.job) {
          applyCompletedJob(payload.job);
          setResultTab("itinerary");
        } else {
          setError(payload.error || "Could not load that trip.");
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load that trip.");
      }
    })();
  }, [hydrated, authUser]);

  const regenerateDay = async (dayNumber: number) => {
    if (!activePlanJobId || regeneratingDay !== null) {
      return;
    }
    setRegeneratingDay(dayNumber);
    setError("");
    try {
      const response = await apiFetch(`/api/plan-jobs/${activePlanJobId}/regenerate-day`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day_number: dayNumber }),
      });
      const payload = await parsePlanResponse(response);
      if (!response.ok) {
        throw new Error(payload.error || "Could not start day regeneration.");
      }
      await pollDayRegeneration(activePlanJobId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not regenerate this day.");
    } finally {
      setRegeneratingDay(null);
    }
  };

  const handleStructuredItineraryChange = (next: StructuredItineraryData | null) => {
    const hotelChanged = next?.locked_hotel_id !== structuredItinerary?.locked_hotel_id;
    const flightChanged = next?.locked_flight_id !== structuredItinerary?.locked_flight_id;
    setStructuredItinerary(next);
    if (next && (hotelChanged || flightChanged)) {
      void persistPlanJobLocks({
        ...(hotelChanged ? { locked_hotel_id: next.locked_hotel_id || "" } : {}),
        ...(flightChanged ? { locked_flight_id: next.locked_flight_id || "" } : {}),
      });
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
    setStructuredItinerary(null);
    setActivePlanJobId(null);
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
      structuredItinerary: structuredItinerary || undefined,
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
    setStructuredItinerary(trip.structuredItinerary || null);
    setActivePlanJobId(null);
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
        apiFetch("/api/trips"),
        apiFetch("/api/preferences"),
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
      const response = await apiFetch("/api/trips", {
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
      const response = await apiFetch(`/api/trips/${tripId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("Could not delete saved trip.");
      }
      setSavedTrips((current) => current.filter((trip) => trip.id !== tripId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete saved trip.");
    }
  };

  const toggleTripSharing = async (tripId: string) => {
    const trip = savedTrips.find((item) => item.id === tripId);
    if (!trip) return;
    try {
      if (trip.shareToken) {
        const response = await apiFetch(`/api/trips/${tripId}/share`, { method: "DELETE" });
        if (!response.ok) {
          throw new Error("Could not stop sharing this trip.");
        }
        setSavedTrips((current) =>
          current.map((item) => (item.id === tripId ? { ...item, shareToken: null } : item)),
        );
      } else {
        const response = await apiFetch(`/api/trips/${tripId}/share`, { method: "POST" });
        const payload = (await parsePlanResponse(response)) as PlanResponse & { shareToken?: string };
        if (!response.ok || !payload.shareToken) {
          throw new Error(payload.error || "Could not create a share link.");
        }
        const shareToken = payload.shareToken;
        setSavedTrips((current) =>
          current.map((item) => (item.id === tripId ? { ...item, shareToken } : item)),
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update trip sharing.");
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
    const response = await apiFetch("/api/preferences", {
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
      const response = await apiFetch("/api/auth/me");
      const payload = await parsePlanResponse(response) as PlanResponse & { user?: AuthUser | null };
      setAuthUser(payload.user || null);
    } catch {
      setAuthUser(null);
    }
  };

  const logout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setAuthUser(null);
    setPreferences(null);
  };

  return (
    <div className="app-shell min-h-screen overflow-x-hidden bg-black text-white">
      <FuturisticCursor />
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
      <div className="fixed inset-0 z-10 bg-[#071012]/38" />
      <div className="fixed inset-0 z-10 bg-[radial-gradient(circle_at_72%_38%,rgba(53,198,204,0.10),transparent_28%,rgba(0,0,0,0.78)_100%)]" />
      <div className="fixed inset-0 z-10 bg-[linear-gradient(180deg,rgba(2,7,9,0.68)_0%,rgba(2,7,9,0.16)_30%,rgba(2,7,9,0.42)_62%,#05090a_100%)]" />
      <div ref={presenceRef} className="hero-presence fixed inset-0 z-10 pointer-events-none" />

      <header className="fixed top-0 z-50 w-full px-3 py-3 text-white sm:px-6 sm:py-5">
        <div className="site-header-shell mx-auto flex max-w-[1340px] items-center justify-between gap-2 rounded-[22px] px-2.5 py-2 sm:rounded-full sm:px-3">
          <a href="#" aria-label="Wanderful home" className="group flex shrink-0 items-center gap-2.5 pr-1 sm:pr-3">
            <span className="brand-mark grid h-9 w-9 place-items-center rounded-[13px] font-serif text-xl italic text-[#06181a]">W</span>
            <span className="hidden text-[15px] font-semibold leading-none tracking-[-0.02em] sm:inline sm:text-[17px]">Wanderful<span className="text-[#66d3d9]">.</span><span className="mt-1 hidden text-[8px] font-medium uppercase tracking-[0.18em] text-white/38 sm:block">Travel intelligence</span></span>
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
                className="nav-link rounded-full px-4 py-2 text-[10px] font-medium tracking-[0.14em] text-white/62 transition-colors duration-200 hover:text-white"
              >
                {item.toUpperCase()}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label={authUser ? `Open profile for ${authUser.name}` : "Sign in"}
              onClick={() => {
                if (authUser) {
                  setProfileOpen(true);
                  return;
                }
                setAuthMode("login");
                setAuthOpen(true);
              }}
              className="header-icon-button inline-flex h-10 w-10 items-center justify-center rounded-full text-white/72 transition hover:text-white sm:w-auto sm:gap-2 sm:px-3"
            >
              <CircleUserRound size={17} strokeWidth={1.7} /><span className="hidden text-[10px] font-medium tracking-[0.12em] sm:inline">{authUser ? authUser.name.split(" ")[0].toUpperCase() : "SIGN IN"}</span>
            </button>

            <button
              type="button"
              aria-label="Open saved trips"
              onClick={() => setSavedTripsOpen(true)}
              className="header-icon-button inline-flex h-10 w-10 items-center justify-center rounded-full text-white/72 transition hover:text-white md:w-auto md:gap-2 md:px-3"
            >
              <Bookmark size={16} strokeWidth={1.7} /><span className="hidden text-[10px] font-medium tracking-[0.12em] md:inline">SAVED TRIPS</span>
            </button>

            {authUser?.status === "active" ? (
              <button type="button" onClick={() => setJobHistoryOpen(true)} className="hidden rounded-full px-3 py-2 text-[10px] font-medium tracking-[0.12em] text-white/78 transition hover:bg-[#3fb6c4]/10 hover:text-white xl:block">
                JOBS
              </button>
            ) : null}

            {authUser?.role === "admin" ? (
              <button type="button" onClick={() => setAdminOpen(true)} className="hidden rounded-full px-3 py-2 text-[10px] font-medium tracking-[0.12em] text-white/78 transition hover:bg-[#3fb6c4]/10 hover:text-white xl:block">
                APPROVALS
              </button>
            ) : null}

            <button
              type="button"
              onClick={scrollToPlanner}
              className="primary-cta inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-[10px] font-semibold tracking-[0.12em] text-[#06181a] transition sm:px-5"
            >
              <span className="sm:hidden">PLAN</span><span className="hidden sm:inline">GET ROAMING</span><ArrowRight size={14} />
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-20 min-h-screen">
        <section className="hero-section relative min-h-screen px-4 pb-12 pt-28 sm:px-8 sm:pb-16 sm:pt-36 lg:px-10">
          <div className="mx-auto flex min-h-[calc(100vh-11rem)] max-w-[1340px] flex-col justify-end">
            <div className="grid items-end gap-10 lg:grid-cols-[1.35fr_.65fr] lg:gap-16">
              <div className={`relative z-20 transition-all duration-1000 ${heroVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
                <div className="mb-6 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.2em] text-white/58">
                  <span className="h-px w-10 bg-[#65d2d9]" /> AI-native travel planning <span className="text-[#f0b86a]">01 / Wander differently</span>
                </div>
                <h1 className="hero-title max-w-[900px] text-[clamp(54px,7.4vw,110px)] font-medium leading-[.88] tracking-[-0.065em] text-white">
                  Venture farther.
                  <span className="mt-2 block font-serif font-normal italic tracking-[-0.04em] text-white/62">Stay in rhythm.</span>
                </h1>
                <p className="mt-7 max-w-xl text-base leading-7 text-white/68 sm:text-lg">
                  A travel workspace that plans with live context, protects what matters, and adapts the moment your day changes.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={scrollToPlanner} className="primary-cta inline-flex items-center gap-3 rounded-full px-6 py-3.5 text-sm font-semibold text-[#06181a]">
                    Build my journey <ArrowRight size={16} />
                  </button>
                  <button type="button" onClick={() => setSavedTripsOpen(true)} className="secondary-cta inline-flex items-center gap-2 rounded-full px-5 py-3.5 text-sm text-white/78">
                    <Bookmark size={15} /> Open travel workspace
                  </button>
                </div>
              </div>

              <div className={`hero-intelligence-card relative z-20 rounded-[30px] p-5 transition-all delay-200 duration-1000 sm:p-6 ${bottomVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/42">Trip intelligence</p><p className="mt-1 text-sm font-medium text-white">Your plan stays alive</p></div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/15 bg-emerald-200/8 px-2.5 py-1 text-[9px] font-medium uppercase tracking-[0.14em] text-emerald-100/80"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,.8)]"/>Live</span>
                </div>
                <div className="mt-6 flex items-center justify-between">
                  <div><p className="text-3xl font-medium tracking-[-.04em] text-white">LAX</p><p className="mt-1 text-xs text-white/42">Los Angeles</p></div>
                  <div className="route-line mx-5 flex flex-1 items-center"><Plane size={15} className="shrink-0 text-[#65d2d9]" /></div>
                  <div className="text-right"><p className="text-3xl font-medium tracking-[-.04em] text-white">HND</p><p className="mt-1 text-xs text-white/42">Tokyo</p></div>
                </div>
                <div className="mt-6 grid grid-cols-3 gap-2">
                  {["Health checked", "Locks protected", "Ready to adapt"].map((label, index) => <div key={label} className="rounded-2xl border border-white/8 bg-white/[.035] p-3"><span className="text-[10px] text-[#65d2d9]">0{index + 1}</span><p className="mt-2 text-xs leading-4 text-white/64">{label}</p></div>)}
                </div>
                <div className="mt-4 flex items-center gap-2 text-xs text-white/46"><Sparkles size={13} className="text-[#f0b86a]"/>Weather shifted. Indoor backup is ready.</div>
              </div>
            </div>

            <div className={`mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5 text-[10px] font-medium uppercase tracking-[0.16em] text-white/38 transition-all delay-300 duration-1000 ${bottomVisible ? "opacity-100" : "opacity-0"}`}>
              <div className="flex flex-wrap gap-x-7 gap-y-2"><span>Live context</span><span>Constraint-aware</span><span>Personal travel memory</span></div>
              <span className="inline-flex items-center gap-2"><Lock size={12}/>Private by design</span>
            </div>
          </div>
        </section>

        <section id="planner" ref={plannerRef} className="planner-section relative z-30 min-h-screen scroll-mt-24 px-4 py-20 sm:px-8 sm:py-28 lg:px-10">
          <div className="mx-auto mb-10 flex max-w-[1240px] flex-wrap items-end justify-between gap-5">
            <div>
              <p className="section-kicker">Your travel intelligence desk</p>
              <h2 className="mt-3 max-w-3xl text-[clamp(38px,5vw,68px)] font-medium leading-[.98] tracking-[-.055em] text-white">Build a trip that can <span className="font-serif font-normal italic text-[#72d7dc]">think on its feet.</span></h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-white/48">Give Wanderful the boundaries. It will coordinate the options, surface the tradeoffs, and keep the plan usable when reality intervenes.</p>
          </div>
          <div className="planner-grid mx-auto grid w-full max-w-[1240px] gap-5 lg:grid-cols-[0.76fr_1.24fr]">
            <div className="planner-story-card order-2 rounded-[30px] p-6 sm:p-8 lg:order-1 lg:sticky lg:top-28 lg:self-start">
              <div className="mb-8 flex items-start justify-between gap-6">
                <div>
                  <p className="section-kicker">01 / Brief the journey</p>
                  <h3 className="mt-4 text-3xl font-medium leading-[1.02] tracking-[-0.045em] text-white sm:text-5xl">
                    Your intent in. A resilient trip out.
                  </h3>
                  <p className="mt-4 max-w-md text-sm leading-6 text-white/48">Wanderful turns six essentials into a living itinerary with evidence, alternatives, and room to change.</p>
                </div>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#65d2d9]/18 bg-[#65d2d9]/10 text-[#72d7dc]"><Sparkles size={19} strokeWidth={1.5} /></span>
              </div>

              <div className="grid gap-3 text-sm text-white/72">
                <InfoRow icon={<Route size={16} strokeWidth={1.5} />} title="Live context, one workspace" text="Routes, stays, weather, and local signals stay connected to the itinerary." />
                <InfoRow icon={<ListChecks size={16} strokeWidth={1.5} />} title="Constraints that mean something" text="Lock non-negotiables and let flexible moments absorb the change." />
                <InfoRow icon={<Sparkles size={16} strokeWidth={1.5} />} title="A planner that learns" text="Every loved and skipped activity sharpens the next recommendation." />
              </div>
              <div className="mt-7 border-t border-white/9 pt-5"><p className="text-[10px] uppercase tracking-[.16em] text-white/34">Designed for the whole trip</p><div className="mt-3 flex flex-wrap gap-2">{["Plan", "Book", "Adapt", "Remember"].map((item) => <span key={item} className="rounded-full border border-white/9 px-3 py-1.5 text-xs text-white/56">{item}</span>)}</div></div>
            </div>

            <form onSubmit={submitPlan} className="planner-form-panel order-1 rounded-[30px] p-5 sm:p-8 lg:order-2">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="section-kicker">02 / Set the boundaries</p>
                  <h3 className="mt-2 text-2xl font-medium tracking-[-.03em] text-white sm:text-3xl">Where, when, and what matters?</h3>
                </div>
                <span className="rounded-full border border-[#65d2d9]/15 bg-[#65d2d9]/8 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/70">
                  {authUser ? "Account workspace" : "Private draft"}
                </span>
              </div>

              {authUser?.status === "pending" ? (
                <div className="mb-5 rounded-3xl border border-amber-200/18 bg-amber-200/[0.08] px-4 py-3 text-sm leading-relaxed text-amber-50/80">
                  Your account is awaiting administrator approval. You can edit your profile, but planning calls remain disabled.
                </div>
              ) : null}
              {!authUser ? (
                <div className="mb-5 rounded-3xl border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.055] px-4 py-3 text-sm leading-relaxed text-white/68">
                  Sign in with an approved account to run live planning and provider searches.
                </div>
              ) : null}

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
                  className="form-control min-h-28 w-full resize-none rounded-[20px] px-4 py-3 text-[15px] text-white outline-none transition placeholder:text-white/30"
                />
              </label>

              <button
                type="submit"
                disabled={loading || !authUser || authUser.status !== "active"}
                className="primary-cta mt-6 flex w-full items-center justify-center gap-3 rounded-[18px] px-8 py-4 text-[15px] font-semibold text-[#06181a] transition-all duration-300 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <ArrowDown size={18} />}
                {loading ? loadingMessages[loadingMessageIndex] : "Generate my Wanderful itinerary"}
              </button>
              {loading && jobProgress ? (
                <p className="mt-3 rounded-2xl border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.055] px-3 py-2 text-sm leading-relaxed text-white/62">
                  {jobProgress}
                </p>
              ) : null}

              {error && <div className="mt-4 rounded-3xl border border-red-300/20 bg-red-500/15 px-4 py-3 text-sm leading-relaxed text-red-50">{error}</div>}
            </form>
          </div>

          {(itinerary || hasAnyOptions(options)) && (
            <section className="results-workspace mx-auto mt-8 max-w-[1240px] rounded-[32px] p-4 sm:p-7">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="section-kicker">{itinerary ? "03 / Your travel workspace" : "Live trip options"}</p>
                  <h3 className="mt-2 text-2xl font-medium tracking-[-.03em] text-white sm:text-3xl">{itinerary ? "Your journey, ready to shape" : "Provider data is ready"}</h3>
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
                structuredItinerary={structuredItinerary}
                onStructuredItineraryChange={handleStructuredItineraryChange}
                options={options}
                onOptionsChange={setOptions}
                activeTab={resultTab}
                onTabChange={setResultTab}
                canRegenerateDay={Boolean(activePlanJobId)}
                regeneratingDay={regeneratingDay}
                onRegenerateDay={regenerateDay}
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
        onOpenJournal={setJournalTrip}
        onOpenGuidebook={setGuidebookTrip}
        onOpenIntelligence={setIntelligenceTrip}
        onToggleShare={toggleTripSharing}
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
      <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} />
      <JobHistoryPanel open={jobHistoryOpen} onClose={() => setJobHistoryOpen(false)} />
      <JournalPanel
        open={Boolean(journalTrip)}
        tripId={journalTrip?.id ?? null}
        tripName={journalTrip?.name}
        onClose={() => setJournalTrip(null)}
      />
      <GuidebookPanel
        open={Boolean(guidebookTrip)}
        tripId={guidebookTrip?.id ?? null}
        tripName={guidebookTrip?.name}
        onClose={() => setGuidebookTrip(null)}
      />
      <TripIntelligencePanel
        trip={intelligenceTrip}
        onClose={() => setIntelligenceTrip(null)}
        onTripUpdated={(updatedTrip) => {
          setIntelligenceTrip(updatedTrip);
          setSavedTrips((current) => current.map((trip) => trip.id === updatedTrip.id ? updatedTrip : trip));
        }}
      />
      <PasswordResetModal
        token={passwordResetToken}
        onClose={() => {
          setPasswordResetToken("");
          window.history.replaceState({}, "", window.location.pathname);
        }}
      />
    </div>
  );
}

function FuturisticCursor() {
  const pointerRef = useRef<HTMLDivElement | null>(null);
  const auraRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!finePointer.matches || reducedMotion.matches) return;

    const root = document.documentElement;
    const pointer = pointerRef.current;
    const aura = auraRef.current;
    if (!pointer || !aura) return;

    root.classList.add("custom-cursor-active");
    let lastInteractive = false;
    let lastEditing = false;

    const handleMove = (event: PointerEvent) => {
      const transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
      pointer.style.transform = transform;
      aura.style.transform = transform;
      pointer.dataset.visible = "true";
      aura.dataset.visible = "true";
      const element = event.target instanceof Element ? event.target : null;
      const interactive = Boolean(element?.closest("a, button, [role='button'], [role='tab']"));
      const editing = Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
      if (interactive !== lastInteractive) {
        pointer.dataset.interactive = String(interactive);
        aura.dataset.interactive = String(interactive);
        lastInteractive = interactive;
      }
      if (editing !== lastEditing) {
        pointer.dataset.editing = String(editing);
        aura.dataset.editing = String(editing);
        lastEditing = editing;
      }
    };
    const handleDown = () => {
      pointer.dataset.pressed = "true";
      aura.dataset.pressed = "true";
    };
    const handleUp = () => {
      pointer.dataset.pressed = "false";
      aura.dataset.pressed = "false";
    };
    const handleLeave = (event: MouseEvent) => {
      if (event.relatedTarget) return;
      pointer.dataset.visible = "false";
      aura.dataset.visible = "false";
    };

    document.addEventListener("pointermove", handleMove, { passive: true });
    document.addEventListener("pointerdown", handleDown, { passive: true });
    document.addEventListener("pointerup", handleUp, { passive: true });
    window.addEventListener("mouseout", handleLeave);
    return () => {
      root.classList.remove("custom-cursor-active");
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerdown", handleDown);
      document.removeEventListener("pointerup", handleUp);
      window.removeEventListener("mouseout", handleLeave);
    };
  }, []);

  return (
    <>
      <div ref={auraRef} aria-hidden="true" className="cursor-golden-aura" />
      <div ref={pointerRef} aria-hidden="true" className="cursor-future-arrow">
        <svg viewBox="0 0 24 30" fill="none">
          <path className="cursor-arrow-edge" d="M2.2 1.7 21.4 18l-8.2 1.2 5 7.6-4.1 2.2-4.8-7.8-6.2 5.6-.9-25.1Z" />
          <path className="cursor-arrow-core" d="m4.3 5 13.4 11.4-7.7 1.1 4.9 7.7-1 .5-4.7-7.8-5 4.5L4.3 5Z" />
        </svg>
        <span className="cursor-tip-flare" />
      </div>
    </>
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
  const [resetEmailSent, setResetEmailSent] = useState(false);
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
      const response = await apiFetch(`/api/auth/${mode === "register" ? "register" : "login"}`, {
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
    <div className="fixed inset-0 z-[95] grid place-items-center bg-[#0e1518]/68 px-4 backdrop-blur-md" onClick={onClose}>
      <form
        onSubmit={submitAuth}
        className="w-[min(94vw,440px)] rounded-[32px] border border-[#3fb6c4]/16 bg-[#0e1518]/88 p-6 shadow-[0_34px_110px_rgba(0,0,0,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">Wanderful Account</p>
            <h3 className="mt-2 text-3xl font-medium tracking-[-0.04em] text-white">
              {mode === "register" ? "Create account" : "Welcome back"}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/8 px-3 py-2 text-sm text-white/72 hover:bg-[#3fb6c4]/14">
            Close
          </button>
        </div>

        {mode === "register" ? (
          <AuthField label="Name" value={name} onChange={setName} autoComplete="name" />
        ) : null}
        <AuthField label="Email" value={email} onChange={setEmail} autoComplete="email" type="email" />
        <AuthField label="Password" value={password} onChange={setPassword} autoComplete={mode === "register" ? "new-password" : "current-password"} type="password" />

        {error ? <p className="mt-3 rounded-2xl border border-red-300/20 bg-red-500/16 px-3 py-2 text-sm text-red-50">{error}</p> : null}

        <button type="submit" disabled={loading} className="mt-5 w-full rounded-full bg-[#3fb6c4] px-4 py-3 text-sm font-medium text-[#06181a] disabled:opacity-60">
          {loading ? "Working..." : mode === "register" ? "Create account" : "Sign in"}
        </button>

        <button
          type="button"
          onClick={() => onModeChange(mode === "register" ? "login" : "register")}
          className="mt-4 w-full text-sm text-white/62 hover:text-white"
        >
          {mode === "register" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
        {mode === "login" ? (
          <button
            type="button"
            onClick={async () => {
              if (!email) {
                setError("Enter your email first.");
                return;
              }
              try {
                await apiFetch("/api/auth/password/request-reset", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email }),
                });
                setResetEmailSent(true);
                setError("");
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not request password reset.");
              }
            }}
            className="mt-3 w-full text-sm text-white/46 hover:text-white"
          >
            Forgot password?
          </button>
        ) : null}
        {resetEmailSent ? <p className="mt-3 text-center text-sm text-white/58">If the account exists, a reset link was sent.</p> : null}
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
        className="h-12 w-full rounded-2xl border border-[#3fb6c4]/16 bg-[#0e1518]/62 px-3 text-sm text-white outline-none transition focus:border-[#3fb6c4]/42"
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
      const response = await apiFetch("/api/preferences", {
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
      const response = await apiFetch("/api/auth/password", {
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
    <div className="fixed inset-0 z-[95] grid place-items-center bg-[#0e1518]/68 px-4 backdrop-blur-md" onClick={onClose}>
      <article
        className="max-h-[90vh] w-[min(94vw,860px)] overflow-auto rounded-[34px] border border-[#3fb6c4]/16 bg-[linear-gradient(145deg,rgba(20,20,20,0.96),rgba(5,5,5,0.94))] shadow-[0_34px_110px_rgba(0,0,0,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[#3fb6c4]/10 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-[#3fb6c4] text-xl font-semibold text-[#06181a] shadow-[0_0_38px_rgba(63,182,196,0.22)]">
                {user.name.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">My Profile</p>
                <h3 className="mt-1 text-3xl font-medium tracking-[-0.04em] text-white">{user.name}</h3>
                <p className="mt-1 text-sm text-white/54">{user.email}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/8 px-3 py-2 text-sm text-white/72 hover:bg-[#3fb6c4]/14">
              Close
            </button>
          </div>
        </div>

        <div className="grid gap-4 p-6 sm:p-8">
          <form onSubmit={saveProfile} className="rounded-[28px] border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.045] p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/38">Profile settings</p>
                <p className="mt-1 text-lg font-medium text-white">Preference memory</p>
              </div>
              <button type="submit" disabled={savingProfile} className="rounded-full bg-[#3fb6c4] px-4 py-2.5 text-sm font-medium text-[#06181a] disabled:opacity-60">
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
            <form onSubmit={changePassword} className="rounded-[24px] border border-[#3fb6c4]/10 bg-[#0e1518]/36 p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/38">Security</p>
              <p className="mt-1 text-lg font-medium text-white">Change password</p>
              <div className="mt-3 grid gap-3">
                <ProfileInput type="password" label="Current password" value={passwordForm.current_password} onChange={(value) => setPasswordForm((current) => ({ ...current, current_password: value }))} />
                <ProfileInput type="password" label="New password" value={passwordForm.new_password} onChange={(value) => setPasswordForm((current) => ({ ...current, new_password: value }))} />
              </div>
              <button type="submit" disabled={savingPassword} className="mt-3 rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.08] px-4 py-2.5 text-sm font-medium text-white/78 hover:bg-[#3fb6c4]/14 disabled:opacity-60">
                {savingPassword ? "Updating..." : "Update password"}
              </button>
              {passwordStatus ? <p className="mt-3 text-sm text-white/62">{passwordStatus}</p> : null}
            </form>

            <div className="rounded-[24px] border border-[#3fb6c4]/10 bg-[#0e1518]/36 p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/38">Account workspace</p>
              <p className="mt-3 text-3xl font-medium text-white">{savedTripCount}</p>
              <p className="mt-1 text-sm text-white/54">saved trip{savedTripCount === 1 ? "" : "s"} in this account</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onOpenSavedTrips} className="rounded-full bg-[#3fb6c4] px-5 py-3 text-sm font-medium text-[#06181a] transition hover:scale-[1.01]">
              Open saved trips
            </button>
            <button type="button" onClick={onLogout} className="rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.055] px-5 py-3 text-sm font-medium text-white/72 transition hover:bg-[#3fb6c4]/12 hover:text-white">
              Log out
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm("Permanently delete your Wanderful account and saved trips?")) return;
                try {
                  const response = await apiFetch("/api/account", { method: "DELETE" });
                  const payload = await parsePlanResponse(response);
                  if (!response.ok) throw new Error(payload.error || "Could not delete account.");
                  onLogout();
                } catch (caught) {
                  setProfileStatus(caught instanceof Error ? caught.message : "Could not delete account.");
                }
              }}
              className="rounded-full border border-red-200/14 bg-red-300/[0.07] px-5 py-3 text-sm font-medium text-red-50/70 transition hover:bg-red-300/12"
            >
              Delete account
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
        className="h-11 w-full rounded-2xl border border-[#3fb6c4]/12 bg-[#0e1518]/52 px-3 text-sm text-white outline-none transition placeholder:text-white/32 focus:border-[#3fb6c4]/38"
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
      <span className="mb-2 block text-[10px] font-medium uppercase tracking-[0.16em] text-white/48">{label}</span>
      <input
        required
        type={type}
        value={value}
        min={min}
        max={max}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="form-control h-12 w-full rounded-[17px] px-4 text-[15px] text-white outline-none transition placeholder:text-white/30"
      />
    </label>
  );
}

function InfoRow({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="feature-row group flex gap-3.5 rounded-[20px] p-4">
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/[.055] text-[#72d7dc] transition group-hover:bg-[#65d2d9]/12">{icon}</div>
      <div>
        <p className="text-sm font-medium text-white/92">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-white/46">{text}</p>
      </div>
    </div>
  );
}

function ItineraryResult({
  form,
  itinerary,
  structuredItinerary,
  onStructuredItineraryChange,
  options,
  onOptionsChange,
  activeTab,
  onTabChange,
  canRegenerateDay,
  regeneratingDay,
  onRegenerateDay,
}: {
  form: PlannerForm;
  itinerary: string;
  structuredItinerary: StructuredItineraryData | null;
  onStructuredItineraryChange: (value: StructuredItineraryData | null) => void;
  options: PlannerOptions;
  onOptionsChange: (options: PlannerOptions) => void;
  activeTab: ResultTab;
  onTabChange: (tab: ResultTab) => void;
  canRegenerateDay: boolean;
  regeneratingDay: number | null;
  onRegenerateDay: (dayNumber: number) => void;
}) {
  const tripLength = getTripLengthLabel(form.start_date, form.end_date);
  const quickFacts = [
    { icon: <MapPin size={16} />, label: "Route", value: `${form.origin || "Origin"} to ${form.destination || "Destination"}` },
    { icon: <CalendarDays size={16} />, label: "Dates", value: `${formatDate(form.start_date)} - ${formatDate(form.end_date)}` },
    { icon: <Wallet size={16} />, label: "Budget", value: `${form.currency_code || "USD"} ${form.budget || "0"}` },
    { icon: <Users size={16} />, label: "Travelers", value: `${form.adults || "1"} adult${form.adults === "1" ? "" : "s"}` },
  ];
  const resultTabs: Array<{ id: ResultTab; label: string; detail: string; icon: ReactNode }> = [
    { id: "itinerary", label: "Journey", detail: "Day-by-day plan", icon: <Route size={17} /> },
    { id: "hotels", label: "Stays", detail: "Map and compare", icon: <Building2 size={17} /> },
    { id: "flights", label: "Flights", detail: "Routes and fares", icon: <Plane size={17} /> },
    { id: "raw", label: "Source", detail: "Full plan notes", icon: <Braces size={17} /> },
  ];

  return (
    <div className="overflow-hidden rounded-[28px] border border-[#3fb6c4]/14 bg-[#0e1518]/70 shadow-[0_24px_90px_rgba(0,0,0,0.32)]">
      <div className="border-b border-[#3fb6c4]/12 bg-[#0e1518]/55 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickFacts.map((fact) => (
            <div key={fact.label} className="rounded-3xl border border-[#3fb6c4]/12 bg-[#0e1518]/65 p-4">
              <div className="flex items-center gap-2 text-white/55">
                {fact.icon}
                <span className="text-[10px] font-medium uppercase tracking-[0.16em]">{fact.label}</span>
              </div>
              <p className="mt-2 text-[15px] font-medium text-white">{fact.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/60">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.05] px-3 py-1.5">
              <Clock size={13} /> {tripLength}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.05] px-3 py-1.5">
              <Sparkles size={13} /> {form.interests || "Custom interests"}
            </span>
          </div>

          <div role="tablist" aria-label="Trip workspace" className="result-tab-list mt-4 grid grid-cols-2 gap-1.5 rounded-[22px] p-1.5 sm:grid-cols-4">
            {resultTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`trip-tab-${tab.id}`}
                aria-controls={`trip-panel-${tab.id}`}
                aria-selected={activeTab === tab.id}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => onTabChange(tab.id)}
                onKeyDown={(event) => {
                  const currentIndex = resultTabs.findIndex((item) => item.id === tab.id);
                  const nextIndex = event.key === "ArrowRight" ? (currentIndex + 1) % resultTabs.length : event.key === "ArrowLeft" ? (currentIndex - 1 + resultTabs.length) % resultTabs.length : event.key === "Home" ? 0 : event.key === "End" ? resultTabs.length - 1 : -1;
                  if (nextIndex < 0) return;
                  event.preventDefault();
                  const nextTab = resultTabs[nextIndex].id;
                  onTabChange(nextTab);
                  window.requestAnimationFrame(() => document.getElementById(`trip-tab-${nextTab}`)?.focus());
                }}
                className={`result-tab flex min-w-0 items-center gap-3 rounded-[17px] px-3 py-3 text-left transition ${activeTab === tab.id ? "result-tab-active" : "text-white/52 hover:text-white/82"}`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/[.055]">{tab.icon}</span>
                <span className="min-w-0"><span className="block text-xs font-semibold text-inherit">{tab.label}</span><span className={`mt-0.5 hidden truncate text-[10px] sm:block ${activeTab === tab.id ? "text-[#06181a]/60" : "text-white/30"}`}>{tab.detail}</span></span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTab === "itinerary" ? (
        <div id="trip-panel-itinerary" role="tabpanel" aria-labelledby="trip-tab-itinerary" className="space-y-5 p-4 sm:p-5">
          <WeatherStrip weather={options.weather || null} />
          {itinerary ? (
            <DayTimeline
              itinerary={itinerary}
              structuredDays={structuredItinerary?.days || []}
              form={form}
              onStructuredDaysChange={(days) => {
                const activityTotal = days.reduce((total, day) => total + (day.estimated_cost || 0), 0);
                onStructuredItineraryChange({
                  ...(structuredItinerary || {}),
                  days,
                  estimated_total: activityTotal,
                });
              }}
              fallbackStartDate={form.start_date}
              fallbackEndDate={form.end_date}
              canRegenerateDay={canRegenerateDay}
              regeneratingDay={regeneratingDay}
              onRegenerateDay={onRegenerateDay}
            />
          ) : (
            <EmptyResult
              icon={<Loader2 className="animate-spin" size={18} />}
              title="Itinerary is being written"
              text="Flights, hotels, map data, and recovery controls are available in the other tabs while the LLM finishes the final plan."
            />
          )}

          {itinerary && structuredItinerary ? <TripEssentials itinerary={structuredItinerary} /> : null}

          {itinerary ? <article className="itinerary-markdown max-h-[620px] overflow-auto rounded-[26px] border border-[#3fb6c4]/12 bg-[#0e1518]/68 p-5 sm:p-7">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[#3fb6c4]/10 pb-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">Detailed Plan</p>
                <p className="mt-1 text-lg font-medium text-white">Full itinerary notes</p>
              </div>
              <span className="rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.06] px-3 py-1.5 text-[11px] text-white/58">
                Markdown source preserved
              </span>
            </div>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ children, href }) => (
                  <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-[#3fb6c4]/15 bg-[#3fb6c4]/10 px-2.5 py-1 text-white hover:bg-[#3fb6c4]/16">
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
        <div id="trip-panel-hotels" role="tabpanel" aria-labelledby="trip-tab-hotels"><HotelMapPanel
            form={form}
            hotels={options.hotels}
            mapCenter={options.map_center}
            lockedHotelId={structuredItinerary?.locked_hotel_id || structuredItinerary?.recommended_hotel_id || ""}
            onLockHotel={(hotelId) => onStructuredItineraryChange({ ...(structuredItinerary || {}), locked_hotel_id: hotelId })}
            onHotelsUpdated={(hotels, mapCenter) => onOptionsChange({ ...options, hotels, map_center: mapCenter })}
          /></div>
      ) : null}

      {activeTab === "flights" ? (
        <div id="trip-panel-flights" role="tabpanel" aria-labelledby="trip-tab-flights"><FlightOptionsPanel
            form={form}
            flights={options.flights}
            recovery={options.flight_recovery}
            priceInsights={options.price_insights || null}
            lockedFlightId={structuredItinerary?.locked_flight_id || structuredItinerary?.recommended_flight_id || ""}
            onLockFlight={(flightId) => onStructuredItineraryChange({ ...(structuredItinerary || {}), locked_flight_id: flightId })}
          /></div>
      ) : null}

      {activeTab === "raw" ? (
        <pre id="trip-panel-raw" role="tabpanel" aria-labelledby="trip-tab-raw" className="max-h-[720px] overflow-auto whitespace-pre-wrap p-5 font-barlow text-[15px] leading-7 text-white/82 sm:p-7">
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
  lockedHotelId,
  onLockHotel,
  onHotelsUpdated,
}: {
  form: PlannerForm;
  hotels: HotelOption[];
  mapCenter: Coordinates | null;
  lockedHotelId: string;
  onLockHotel: (hotelId: string) => void;
  onHotelsUpdated: (hotels: HotelOption[], mapCenter: Coordinates | null) => void;
}) {
  const [selectedHotelId, setSelectedHotelId] = useState(hotels[0]?.id || "");
  const mapShellRef = useRef<HTMLDivElement | null>(null);
  const [nightlyBudget, setNightlyBudget] = useState(() => inferInitialNightlyBudget(form));
  const [hotelStatus, setHotelStatus] = useState("");
  const [hotelStatusIsError, setHotelStatusIsError] = useState(false);
  const [hotelLoading, setHotelLoading] = useState(false);
  const hotelsWithCoordinates = hotels.filter((hotel) => hotel.coordinates);
  const selectedHotel = hotels.find((hotel) => hotel.id === selectedHotelId) || hotels[0];
  const center = selectedHotel?.coordinates || mapCenter || hotelsWithCoordinates[0]?.coordinates || { lat: 39.5, lng: -98.35 };

  useEffect(() => {
    setSelectedHotelId(hotels[0]?.id || "");
  }, [hotels]);

  const selectHotel = (hotelId: string) => {
    setSelectedHotelId(hotelId);
    mapShellRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
        <div className="rounded-[28px] border border-[#3fb6c4]/12 bg-[radial-gradient(circle_at_20%_0%,rgba(63,182,196,0.16),transparent_34%),rgba(0,0,0,0.68)] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.28)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/50">Stay Finder</p>
              <h4 className="mt-1 text-2xl font-medium tracking-[-0.04em] text-white">Compare your base</h4>
              <p className="mt-2 text-sm leading-relaxed text-white/62">
                Pick a hotel to preview where it sits on the map. The AI itinerary remains unchanged for now.
              </p>
            </div>
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#3fb6c4] text-[#06181a] shadow-[0_0_38px_rgba(63,182,196,0.18)]">
              <Building2 size={20} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <StatPill label="Options" value={String(hotels.length)} />
            <StatPill label="Mapped" value={String(hotelsWithCoordinates.length)} />
            <StatPill label="Selected" value={selectedHotel?.nightly_rate || selectedHotel?.hotel_class || "Ready"} />
          </div>
          <div className="mt-5 rounded-[22px] border border-[#3fb6c4]/10 bg-[#0e1518]/35 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/42">Nightly Price Filter</p>
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
            onClick={(event) => {
              selectHotel(hotel.id);
              event.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                selectHotel(hotel.id);
                event.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }}
            role="button"
            tabIndex={0}
            style={{ animationDelay: `${Math.min(hotelIndex, 8) * 45}ms` }}
            className={`hotel-option-card card-hover card-enter group w-full cursor-pointer rounded-[26px] border p-4 text-left focus:outline-none focus:ring-2 focus:ring-[#3fb6c4]/30 ${
              selectedHotel?.id === hotel.id
                ? "border-[#3fb6c4]/60 bg-[#3fb6c4]/[0.16]"
                : "border-[#3fb6c4]/12 bg-[#0e1518]/58 hover:border-[#3fb6c4]/28 hover:bg-[#3fb6c4]/[0.08]"
            }`}
          >
            {hotel.image_thumbnail ? (
              <img
                src={hotel.image_thumbnail}
                alt={hotel.name}
                loading="lazy"
                className="mb-3 h-36 w-full rounded-2xl border border-[#3fb6c4]/10 object-cover"
              />
            ) : null}
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                  {hotel.rank ? `Rank #${hotel.rank}` : hotel.hotel_class || "Recommended stay"}
                </p>
                <p className="mt-1 text-lg font-medium leading-tight text-white">{hotel.name}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {hotel.rank_score ? <span className="rounded-full bg-[#3fb6c4] px-2.5 py-1 text-[11px] font-semibold text-[#06181a]">{hotel.rank_score} match</span> : null}
                {hotel.coordinates ? <span className="rounded-full border border-[#3fb6c4]/12 px-2.5 py-1 text-[11px] text-white/62">Mapped</span> : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {hotel.nightly_rate ? <HotelMetric label="Night" value={hotel.nightly_rate} /> : null}
              {hotel.rating ? <HotelMetric label="Rating" value={`${hotel.rating}${hotel.reviews ? ` (${hotel.reviews})` : ""}`} /> : null}
              {hotel.estimated_total ? <HotelMetric label="Est. total" value={`${hotel.currency || ""} ${hotel.estimated_total}`} /> : null}
            </div>
            {hotel.description ? <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-white/58">{hotel.description}</p> : null}
            {hotel.amenities?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {hotel.amenities.slice(0, 8).map((amenity) => (
                  <span key={amenity} className="rounded-full border border-[#3fb6c4]/10 bg-[#0e1518]/20 px-2.5 py-1 text-[11px] text-white/62">
                    {amenity}
                  </span>
                ))}
              </div>
            ) : null}
            {hotel.rank_reasons?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {hotel.rank_reasons.map((reason) => (
                  <span key={reason} className="rounded-full border border-emerald-200/12 bg-emerald-200/[0.07] px-2.5 py-1 text-[11px] text-emerald-50/70">
                    {reason}
                  </span>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onLockHotel(lockedHotelId === hotel.id ? "" : hotel.id);
              }}
              className={`mt-4 rounded-full px-3 py-1.5 text-sm transition ${
                lockedHotelId === hotel.id ? "bg-[#3fb6c4] text-[#06181a]" : "border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.06] text-white/72 hover:bg-[#3fb6c4]/12"
              }`}
            >
              {lockedHotelId === hotel.id ? "Locked selection" : "Lock this hotel"}
            </button>
            {hotel.link ? (
              <a
                href={hotel.link}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.08] px-3 py-1.5 text-sm text-white/78 transition hover:bg-[#3fb6c4] hover:text-[#06181a]"
              >
                View hotel <ExternalLink size={12} />
              </a>
            ) : null}
          </article>
        ))}
      </div>

      <div ref={mapShellRef} className="hotel-map-shell relative overflow-hidden rounded-[34px] border border-[#3fb6c4]/14 bg-[#0e1518]/60 shadow-[0_32px_110px_rgba(0,0,0,0.44)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] h-28 bg-gradient-to-b from-black/70 to-transparent" />
        <div className="pointer-events-none absolute left-4 right-4 top-4 z-[501] flex flex-wrap items-start justify-between gap-3">
          <div className="rounded-2xl border border-[#3fb6c4]/12 bg-[#0e1518]/72 px-4 py-3 backdrop-blur-md">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">OpenStreetMap</p>
            <p className="mt-1 text-sm font-medium text-white">{hotelsWithCoordinates.length} mapped option{hotelsWithCoordinates.length === 1 ? "" : "s"}</p>
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
    <div className="rounded-2xl border border-[#3fb6c4]/10 bg-[#0e1518]/35 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-white/38">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function HotelMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.075] px-3 py-1.5 text-xs text-white/74">
      <span className="text-white/38">{label}</span> {value}
    </span>
  );
}

function weatherIcon(group?: string | null) {
  switch (group) {
    case "Clear":
      return Sun;
    case "Clouds":
      return Cloud;
    case "Rain":
    case "Drizzle":
      return CloudRain;
    case "Thunderstorm":
      return CloudLightning;
    case "Snow":
      return CloudSnow;
    case "Mist":
    case "Fog":
    case "Haze":
    case "Smoke":
    case "Dust":
    case "Sand":
      return CloudFog;
    default:
      return Cloud;
  }
}

function formatWeatherDay(dateStr: string) {
  const parsed = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dateStr;
  }
  return parsed.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function WeatherStrip({ weather }: { weather: WeatherInfo | null }) {
  if (!weather?.days?.length) {
    return null;
  }
  const unitSymbol = weather.units === "metric" ? "C" : weather.units === "standard" ? "K" : "F";
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {weather.days.map((day, dayIndex) => {
        const Icon = weatherIcon(day.condition_group);
        return (
          <div
            key={day.date}
            style={{ animationDelay: `${Math.min(dayIndex, 8) * 45}ms` }}
            className="card-hover card-enter flex min-w-[132px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.06] px-3 py-3 text-center hover:border-[#3fb6c4]/26 hover:bg-[#3fb6c4]/[0.1]"
          >
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/45">{formatWeatherDay(day.date)}</p>
            <Icon size={22} className="text-white/85" />
            <p className="text-sm font-medium text-white">
              {day.temp_high != null ? Math.round(day.temp_high) : "--"}&deg;/{day.temp_low != null ? Math.round(day.temp_low) : "--"}&deg;{unitSymbol}
            </p>
            {day.conditions_label ? <p className="text-[11px] text-white/55">{day.conditions_label}</p> : null}
            {day.precip_probability != null && day.precip_probability >= 30 ? (
              <span className="rounded-full border border-sky-200/20 bg-sky-200/[0.08] px-2 py-0.5 text-[10px] text-sky-100/80">
                {Math.round(day.precip_probability)}% rain
              </span>
            ) : null}
          </div>
        );
      })}
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
  priceInsights,
  lockedFlightId,
  onLockFlight,
}: {
  form: PlannerForm;
  flights: FlightOption[];
  recovery: FlightRecoverySuggestion[];
  priceInsights: PriceInsights | null;
  lockedFlightId: string;
  onLockFlight: (flightId: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
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
    setInstruction("");
    setStatus("");
    setFlightSearch({
      origin: form.origin,
      destination: form.destination,
      start_date: form.start_date,
      end_date: form.end_date,
    });
  }, [flights, recovery, priceInsights, form.origin, form.destination, form.start_date, form.end_date]);

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
      setCurrentFlights(payload.flights || []);
      setCurrentRecovery(payload.recovery_suggestions || []);
      setCurrentPriceInsights(payload.price_insights || null);
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
        <div className="rounded-[28px] border border-[#3fb6c4]/12 bg-[radial-gradient(circle_at_12%_0%,rgba(63,182,196,0.16),transparent_36%),rgba(0,0,0,0.68)] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.28)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/50">Flight Board</p>
              <h4 className="mt-1 text-2xl font-medium tracking-[-0.04em] text-white">
                {flightSearch.origin || "Origin"} to {flightSearch.destination || "Destination"}
              </h4>
              <p className="mt-2 text-sm leading-relaxed text-white/62">
                Compare available routes, continue to provider booking options, or retry nearby dates and airports without rebuilding the whole trip.
              </p>
            </div>
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#3fb6c4] text-[#06181a] shadow-[0_0_38px_rgba(63,182,196,0.18)]">
              <Plane size={20} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatPill label="Options" value={String(currentFlights.length)} />
            <StatPill label="Depart" value={formatDate(flightSearch.start_date)} />
            <StatPill label="Return" value={formatDate(flightSearch.end_date)} />
            <StatPill label="Recovery" value={currentRecovery.length ? "Available" : "Clear"} />
          </div>
          {currentPriceInsights?.typical_price_range ? (
            <p className="mt-3 text-xs text-white/50">
              Typical price for this route: {form.currency_code || "USD"} {currentPriceInsights.typical_price_range[0]}-{currentPriceInsights.typical_price_range[1]}
              {currentPriceInsights.price_level ? ` (currently ${currentPriceInsights.price_level})` : ""}
            </p>
          ) : null}
        </div>

        {currentFlights.length ? (
          currentFlights.map((flight, flightIndex) => (
            <article
              key={flight.id}
              onClick={(event) => {
                setSelectedFlight(flight);
                event.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  setSelectedFlight(flight);
                  event.currentTarget.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              }}
              role="button"
              tabIndex={0}
              style={{ animationDelay: `${Math.min(flightIndex, 8) * 45}ms` }}
              className="flight-option-card card-hover card-enter block w-full cursor-pointer rounded-[28px] border border-[#3fb6c4]/12 bg-[#0e1518]/70 p-5 text-left shadow-[0_20px_70px_rgba(0,0,0,0.28)] hover:border-[#3fb6c4]/28 focus:outline-none focus:ring-2 focus:ring-[#3fb6c4]/30"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                    {flight.rank ? `Rank #${flight.rank}` : `Option ${flightIndex + 1}`}
                  </p>
                  <p className="mt-1 text-3xl font-medium tracking-[-0.05em] text-white">{formatFlightPrice(flight)}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/62">
                    <span className="rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.07] px-3 py-1.5">{formatFlightDuration(flight.total_duration_minutes)}</span>
                    <span className="rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.07] px-3 py-1.5">
                      {flight.has_return_details ? "Round-trip details found" : "Return details may be incomplete"}
                    </span>
                    <span className="rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.07] px-3 py-1.5">{getFlightAirlines(flight)}</span>
                    {flight.rank_score ? <span className="rounded-full bg-[#3fb6c4] px-3 py-1.5 font-semibold text-[#06181a]">{flight.rank_score} match</span> : null}
                  </div>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {(flight.segments || []).map((segment, index) => {
                  const segments = flight.segments || [];
                  const layover = flight.layovers?.[index];
                  const isLast = index === segments.length - 1;
                  return (
                    <div key={`${flight.id}-${index}`}>
                      <div className="flight-segment-row rounded-[22px] border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.055] p-4">
                        <div className="flex items-center gap-3">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#3fb6c4] text-[#06181a]">
                            <Plane size={16} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-white">{segment.airline || "Airline"}</p>
                              {segment.flight_number ? <span className="rounded-full bg-[#0e1518]/35 px-2 py-0.5 text-[11px] text-white/48">{segment.flight_number}</span> : null}
                            </div>
                            <p className="mt-1 text-sm text-white/54">
                              {segment.from || "?"} to {segment.to || "?"} - {segment.depart_at || "departure TBD"}
                              {segment.arrive_at ? ` to ${segment.arrive_at}` : ""}
                            </p>
                          </div>
                          <p className="hidden rounded-full border border-[#3fb6c4]/10 bg-[#0e1518]/30 px-3 py-1 text-xs text-white/52 sm:block">
                            {formatFlightDuration(segment.duration_minutes)}
                          </p>
                        </div>
                      </div>
                      {!isLast && layover ? (
                        <div className="ml-5 flex items-center gap-2 border-l border-dashed border-[#3fb6c4]/15 py-2 pl-4 text-[11px] text-amber-100/70">
                          <Clock size={12} />
                          <span>
                            Layover{layover.name ? ` in ${layover.name}` : layover.id ? ` at ${layover.id}` : ""}
                            {layover.duration ? ` - ${formatFlightDuration(layover.duration)}` : ""}
                            {layover.overnight ? " (overnight)" : ""}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {flight.rank_reasons?.length ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {flight.rank_reasons.map((reason) => (
                    <span key={reason} className="rounded-full border border-emerald-200/12 bg-emerald-200/[0.07] px-2.5 py-1 text-[11px] text-emerald-50/70">
                      {reason}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#3fb6c4]/10 pt-4">
                <p className="max-w-2xl text-xs leading-relaxed text-white/42">
                  {flight.carbon_emissions?.difference_percent != null
                    ? `Estimated emissions ${Math.abs(flight.carbon_emissions.difference_percent)}% ${
                        flight.carbon_emissions.difference_percent < 0 ? "below" : "above"
                      } typical for this route.`
                    : "Provider result normalized from SerpAPI Google Flights."}
                </p>
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
                    onLockFlight(lockedFlightId === flight.id ? "" : flight.id);
                  }}
                  className={`rounded-full px-3 py-1.5 text-sm transition ${
                    lockedFlightId === flight.id ? "bg-[#3fb6c4] text-[#06181a]" : "border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.08] text-white/78 hover:bg-[#3fb6c4] hover:text-[#06181a]"
                  }`}
                >
                  {lockedFlightId === flight.id ? "Locked selection" : "Lock this flight"}
                </button>
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
          <p className="mt-3 rounded-2xl border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.055] px-3 py-2 text-xs leading-relaxed text-white/56">
            City names are converted to likely airport codes automatically, for example Los Angeles to LAX and San Jose to SJC.
          </p>
        </div>

        <div className="rounded-[26px] border border-[#3fb6c4]/12 bg-[#0e1518]/68 p-4 shadow-[0_18px_55px_rgba(0,0,0,0.2)]">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">Try another search</p>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={4}
            placeholder="Try leaving two days earlier, use SFO instead, or try nearby airports."
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
      const response = await apiFetch("/api/flight-return-options", {
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
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[#0e1518]/70 px-4 backdrop-blur-md" onClick={onClose}>
      <article
        className="max-h-[88vh] w-[min(94vw,920px)] overflow-auto rounded-[34px] border border-[#3fb6c4]/16 bg-[linear-gradient(145deg,rgba(22,22,22,0.97),rgba(6,6,6,0.96))] p-6 shadow-[0_34px_120px_rgba(0,0,0,0.62)] sm:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Flight Details</p>
            <h3 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-white sm:text-5xl">{formatFlightPrice(activeFlight)}</h3>
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
            <p className="text-sm font-medium text-white">Return details may be incomplete</p>
            <p className="mt-2 text-sm leading-relaxed text-white/62">
              Google Flights sometimes returns the outbound leg first and provides a departure token for selecting return flights. This app keeps the result visible, but final verification should happen in Google Flights or a booking provider before purchase.
            </p>
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
    </div>
  );
}

function EmptyResult({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[26px] border border-[#3fb6c4]/12 bg-[#0e1518]/62 p-8 text-center">
      <div className="mb-3 rounded-full border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.07] p-3 text-white/68">{icon}</div>
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
  onOpenJournal,
  onOpenGuidebook,
  onOpenIntelligence,
  onToggleShare,
}: {
  open: boolean;
  trips: SavedTrip[];
  accountMode: boolean;
  onClose: () => void;
  onLoad: (trip: SavedTrip) => void;
  onDelete: (tripId: string) => void;
  onNewTrip: () => void;
  onOpenJournal: (trip: SavedTrip) => void;
  onOpenGuidebook: (trip: SavedTrip) => void;
  onOpenIntelligence: (trip: SavedTrip) => void;
  onToggleShare: (tripId: string) => void;
}) {
  useEscapeToClose(open, onClose);
  const [copiedTripId, setCopiedTripId] = useState<string | null>(null);

  if (!open) {
    return null;
  }

  const copyShareLink = async (trip: SavedTrip) => {
    if (!trip.shareToken) return;
    const url = `${window.location.origin}/share/${trip.shareToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedTripId(trip.id);
      window.setTimeout(() => setCopiedTripId((current) => (current === trip.id ? null : current)), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-[#0e1518]/58 backdrop-blur-sm" onClick={onClose}>
      <aside
        className="absolute right-0 top-0 h-full w-[min(94vw,430px)] overflow-auto border-l border-[#3fb6c4]/12 bg-[#0e1518]/88 p-5 shadow-[-28px_0_90px_rgba(0,0,0,0.45)]"
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
          <button type="button" onClick={onClose} className="rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/8 px-3 py-2 text-sm text-white/72 hover:bg-[#3fb6c4]/14">
            Close
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            onNewTrip();
            onClose();
          }}
          className="mb-4 w-full rounded-full bg-[#3fb6c4] px-4 py-3 text-sm font-medium text-[#06181a] transition hover:scale-[1.01]"
        >
          Start a new trip
        </button>

        {trips.length ? (
          <div className="space-y-3">
            {trips.map((trip, tripIndex) => (
              <article
                key={trip.id}
                style={{ animationDelay: `${Math.min(tripIndex, 8) * 45}ms` }}
                className="card-hover card-enter rounded-[24px] border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.055] p-4 hover:border-[#3fb6c4]/28 hover:bg-[#3fb6c4]/[0.09]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-medium leading-tight text-white">{trip.name}</h4>
                    <p className="mt-1 text-sm text-white/56">{trip.destination} - {trip.dateRange}</p>
                    <p className="mt-2 text-xs text-white/38">Saved {formatSavedAt(trip.savedAt)}</p>
                  </div>
                  <MapPin className="mt-1 shrink-0 text-white/42" size={18} />
                </div>
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => onLoad(trip)} className="flex-1 rounded-full bg-[#3fb6c4] px-3 py-2 text-sm font-medium text-[#06181a]">
                    Open
                  </button>
                  <button type="button" onClick={() => onDelete(trip.id)} className="rounded-full border border-[#3fb6c4]/12 bg-[#0e1518]/35 px-3 py-2 text-sm text-white/68 hover:bg-[#3fb6c4]/10">
                    Delete
                  </button>
                </div>
                {accountMode ? (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenIntelligence(trip)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full border border-[#3fb6c4]/20 bg-[#3fb6c4]/10 px-3 py-2 text-xs text-white/78 hover:bg-[#3fb6c4]/16"
                    >
                      <Sparkles size={13} /> Trip Health
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenJournal(trip)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full border border-[#3fb6c4]/12 bg-[#0e1518]/35 px-3 py-2 text-xs text-white/68 hover:bg-[#3fb6c4]/10"
                    >
                      <BookOpen size={13} /> Journal
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenGuidebook(trip)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full border border-[#3fb6c4]/12 bg-[#0e1518]/35 px-3 py-2 text-xs text-white/68 hover:bg-[#3fb6c4]/10"
                    >
                      <Compass size={13} /> Guidebook
                    </button>
                  </div>
                ) : null}
                {accountMode ? (
                  trip.shareToken ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => copyShareLink(trip)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full border border-[#3fb6c4]/20 bg-[#3fb6c4]/10 px-3 py-2 text-xs text-white/78 hover:bg-[#3fb6c4]/16"
                      >
                        {copiedTripId === trip.id ? (
                          <>
                            <Check size={13} /> Copied
                          </>
                        ) : (
                          <>
                            <Copy size={13} /> Copy link
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleShare(trip.id)}
                        className="rounded-full border border-[#3fb6c4]/12 bg-[#0e1518]/35 px-3 py-2 text-xs text-white/68 hover:bg-[#3fb6c4]/10"
                      >
                        Stop sharing
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onToggleShare(trip.id)}
                      className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-full border border-[#3fb6c4]/12 bg-[#0e1518]/35 px-3 py-2 text-xs text-white/68 hover:bg-[#3fb6c4]/10"
                    >
                      <Share2 size={13} /> Share publicly
                    </button>
                  )
                ) : null}
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

function TripEssentials({ itinerary }: { itinerary: StructuredItineraryData }) {
  const budgetCategories = itinerary.budget_categories || [];
  const packingList = itinerary.packing_list || [];
  const logistics = itinerary.logistics || [];
  const risks = itinerary.risks || [];
  const warnings = itinerary.validation_warnings || [];
  const currency = itinerary.currency_code || "USD";

  if (!budgetCategories.length && !packingList.length && !logistics.length && !risks.length && !warnings.length) {
    return null;
  }

  return (
    <section className="rounded-[28px] border border-[#3fb6c4]/12 bg-[#0e1518]/62 p-5 sm:p-6">
      <div className="mb-4">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">Trip Essentials</p>
        <h4 className="mt-1 text-xl font-medium tracking-[-0.02em] text-white">Budget, packing, and logistics</h4>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {budgetCategories.length ? (
          <div className="rounded-[22px] border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.045] p-4">
            <div className="mb-3 flex items-center gap-2 text-white/55">
              <Wallet size={15} />
              <span className="text-[10px] font-medium uppercase tracking-[0.15em]">Budget breakdown</span>
            </div>
            <div className="space-y-2">
              {budgetCategories.map((item, index) => (
                <div key={`${item.category}-${index}`} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium text-white/85">{item.category}</p>
                    {item.note ? <p className="text-[12px] text-white/50">{item.note}</p> : null}
                  </div>
                  <p className="shrink-0 font-medium text-white/85">
                    {currency} {(item.amount || 0).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {packingList.length ? (
          <div className="rounded-[22px] border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.045] p-4">
            <div className="mb-3 flex items-center gap-2 text-white/55">
              <ListChecks size={15} />
              <span className="text-[10px] font-medium uppercase tracking-[0.15em]">Packing list</span>
            </div>
            <ul className="space-y-1.5 text-sm text-white/76">
              {packingList.map((item, index) => (
                <li key={`packing-${index}`}>- {item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {logistics.length ? (
          <div className="rounded-[22px] border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.045] p-4">
            <div className="mb-3 flex items-center gap-2 text-white/55">
              <MapPin size={15} />
              <span className="text-[10px] font-medium uppercase tracking-[0.15em]">Logistics</span>
            </div>
            <ul className="space-y-1.5 text-sm text-white/76">
              {logistics.map((item, index) => (
                <li key={`logistics-${index}`}>- {item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {risks.length || warnings.length ? (
          <div className="rounded-[22px] border border-amber-300/25 bg-amber-300/[0.06] p-4">
            <div className="mb-3 flex items-center gap-2 text-amber-200/80">
              <AlertTriangle size={15} />
              <span className="text-[10px] font-medium uppercase tracking-[0.15em]">Risks and warnings</span>
            </div>
            <ul className="space-y-1.5 text-sm text-amber-100/80">
              {[...risks, ...warnings].map((item, index) => (
                <li key={`risk-${index}`}>- {item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DayTimeline({
  itinerary,
  structuredDays,
  form,
  onStructuredDaysChange,
  fallbackStartDate,
  fallbackEndDate,
  canRegenerateDay,
  regeneratingDay,
  onRegenerateDay,
}: {
  itinerary: string;
  structuredDays: StructuredDayData[];
  form: PlannerForm;
  onStructuredDaysChange: (days: StructuredDayData[]) => void;
  fallbackStartDate: string;
  fallbackEndDate: string;
  canRegenerateDay: boolean;
  regeneratingDay: number | null;
  onRegenerateDay: (dayNumber: number) => void;
}) {
  const days = structuredDays.length
    ? structuredDays.map(structuredDayToDayPlan)
    : extractDayPlans(itinerary, fallbackStartDate, fallbackEndDate);
  const [selectedDay, setSelectedDay] = useState<DayPlan | null>(null);
  const selectedStructuredDay = selectedDay
    ? structuredDays.find((day) => `Day ${day.day_number}` === selectedDay.day) || null
    : null;

  if (!days.length) {
    return (
      <div className="rounded-[28px] border border-[#3fb6c4]/12 bg-[#0e1518]/62 p-5">
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
    <section className="rounded-[30px] border border-[#3fb6c4]/10 bg-[linear-gradient(135deg,rgba(63,182,196,0.09),rgba(63,182,196,0.025))] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.28)]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">Day-by-day flow</p>
          <h4 className="mt-1 text-2xl font-medium tracking-[-0.035em] text-white sm:text-3xl">
            Your trip at a glance
          </h4>
        </div>
        <div className="rounded-full border border-[#3fb6c4]/10 bg-[#0e1518]/35 px-3 py-1.5 text-[11px] font-medium text-white/62">
          Swipe horizontally
        </div>
      </div>

      <div className="day-timeline-scroll flex gap-4 overflow-x-auto pb-3">
        {days.map((day, index) => (
          <button
            key={`${day.day}-${index}`}
            type="button"
            onClick={(event) => {
              setSelectedDay(day);
              event.currentTarget.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
            }}
            style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
            className="day-card card-hover card-enter group min-w-[280px] max-w-[320px] flex-1 rounded-[28px] border border-[#3fb6c4]/12 bg-[#0e1518]/48 p-4 text-left hover:border-[#3fb6c4]/30 hover:bg-[#0e1518]/62"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">{day.day}</p>
                <h5 className="mt-2 text-xl font-medium leading-tight tracking-[-0.03em] text-white">
                  {day.title}
                </h5>
              </div>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#3fb6c4] text-sm font-semibold text-[#06181a] shadow-[0_0_30px_rgba(63,182,196,0.22)]">
                {index + 1}
              </div>
            </div>

            {day.summary ? <p className="mb-4 line-clamp-3 text-sm leading-relaxed text-white/58">{day.summary}</p> : null}

            <div className="space-y-2">
              {day.bullets.slice(0, 4).map((bullet, bulletIndex) => (
                <div key={`${day.day}-bullet-${bulletIndex}`} className="rounded-2xl border border-[#3fb6c4]/10 bg-[#0e1518]/44 px-3 py-2 text-sm leading-relaxed text-white/76">
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

      <DayDetailModal
        day={selectedDay}
        structuredDay={selectedStructuredDay}
        allStructuredDays={structuredDays}
        form={form}
        onStructuredDaysChange={onStructuredDaysChange}
        onClose={() => setSelectedDay(null)}
        canRegenerateDay={canRegenerateDay}
        regeneratingDay={regeneratingDay}
        onRegenerateDay={onRegenerateDay}
      />
    </section>
  );
}

function DayDetailModal({
  day,
  structuredDay,
  allStructuredDays,
  form,
  onStructuredDaysChange,
  onClose,
  canRegenerateDay,
  regeneratingDay,
  onRegenerateDay,
}: {
  day: DayPlan | null;
  structuredDay: StructuredDayData | null;
  allStructuredDays: StructuredDayData[];
  form: PlannerForm;
  onStructuredDaysChange: (days: StructuredDayData[]) => void;
  onClose: () => void;
  canRegenerateDay: boolean;
  regeneratingDay: number | null;
  onRegenerateDay: (dayNumber: number) => void;
}) {
  useEscapeToClose(Boolean(day), onClose);

  if (!day) {
    return null;
  }

  const isRegeneratingThisDay = structuredDay ? regeneratingDay === structuredDay.day_number : false;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[#0e1518]/68 px-4 backdrop-blur-md" onClick={onClose}>
      <article
        className="max-h-[86vh] w-[min(94vw,760px)] overflow-auto rounded-[34px] border border-[#3fb6c4]/16 bg-[linear-gradient(145deg,rgba(22,22,22,0.96),rgba(6,6,6,0.94))] p-6 shadow-[0_34px_110px_rgba(0,0,0,0.55)] sm:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">{day.day}</p>
            <h3 className="mt-2 text-3xl font-medium leading-tight tracking-[-0.04em] text-white sm:text-5xl">{day.title}</h3>
            {day.summary ? <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/62">{day.summary}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {structuredDay && canRegenerateDay ? (
              <button
                type="button"
                onClick={() => onRegenerateDay(structuredDay.day_number)}
                disabled={regeneratingDay !== null}
                className="rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/8 px-3 py-2 text-sm text-white/72 transition hover:bg-[#3fb6c4]/14 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRegeneratingThisDay ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="animate-spin" size={14} /> Regenerating...
                  </span>
                ) : (
                  "Regenerate this day"
                )}
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/8 px-3 py-2 text-sm text-white/72 hover:bg-[#3fb6c4]/14">
              Close
            </button>
          </div>
        </div>

        {structuredDay ? (
          <StructuredDayEditor
            day={structuredDay}
            allDays={allStructuredDays}
            form={form}
            onDaysChange={onStructuredDaysChange}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(day.details.length ? day.details : day.bullets).slice(0, 12).map((detail, index) => (
              <div key={`${day.day}-detail-${index}`} className="rounded-[22px] border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.055] p-4">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/38">Stop {index + 1}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/76">{detail}</p>
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

function StructuredDayEditor({
  day,
  allDays,
  form,
  onDaysChange,
}: {
  day: StructuredDayData;
  allDays: StructuredDayData[];
  form: PlannerForm;
  onDaysChange: (days: StructuredDayData[]) => void;
}) {
  const [replacementIndex, setReplacementIndex] = useState<number | null>(null);
  const [alternatives, setAlternatives] = useState<StructuredActivityData[]>([]);
  const [replacementStatus, setReplacementStatus] = useState("");
  const [loadingAlternatives, setLoadingAlternatives] = useState(false);

  const commit = (nextDays: StructuredDayData[]) => {
    onDaysChange(recalculateStructuredDays(nextDays));
  };

  const updateActivity = (index: number, patch: Partial<StructuredActivityData>) => {
    commit(
      allDays.map((candidate) =>
        candidate.day_number === day.day_number
          ? {
              ...candidate,
              activities: (candidate.activities || []).map((activity, activityIndex) =>
                activityIndex === index ? { ...activity, ...patch } : activity
              ),
            }
          : candidate
      )
    );
  };

  const deleteActivity = (index: number) => {
    commit(
      allDays.map((candidate) =>
        candidate.day_number === day.day_number
          ? { ...candidate, activities: (candidate.activities || []).filter((_, activityIndex) => activityIndex !== index) }
          : candidate
      )
    );
  };

  const moveActivity = (index: number, targetDayNumber: number) => {
    const activity = (day.activities || [])[index];
    if (!activity || targetDayNumber === day.day_number) {
      return;
    }
    commit(
      allDays.map((candidate) => {
        if (candidate.day_number === day.day_number) {
          return { ...candidate, activities: (candidate.activities || []).filter((_, activityIndex) => activityIndex !== index) };
        }
        if (candidate.day_number === targetDayNumber) {
          return { ...candidate, activities: [...(candidate.activities || []), activity] };
        }
        return candidate;
      })
    );
  };

  const loadAlternatives = async (index: number) => {
    const activity = (day.activities || [])[index];
    if (!activity) {
      return;
    }
    setReplacementIndex(index);
    setAlternatives([]);
    setReplacementStatus("");
    setLoadingAlternatives(true);
    try {
      const response = await apiFetch("/api/activity-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          period: activity.period || "activity",
          weather_note: day.weather_note || "",
          exclude_titles: allDays.flatMap((candidate) => (candidate.activities || []).map((item) => item.title)),
        }),
      });
      const payload = await parsePlanResponse(response) as PlanResponse & { alternatives?: StructuredActivityData[] };
      if (!response.ok) {
        throw new Error(payload.error || "Could not load activity alternatives.");
      }
      setAlternatives(Array.isArray(payload.alternatives) ? payload.alternatives : []);
      setReplacementStatus(payload.alternatives?.length ? "Choose a replacement." : "No alternatives were returned.");
    } catch (caught) {
      setReplacementStatus(caught instanceof Error ? caught.message : "Could not load activity alternatives.");
    } finally {
      setLoadingAlternatives(false);
    }
  };

  const chooseAlternative = (alternative: StructuredActivityData) => {
    if (replacementIndex === null) {
      return;
    }
    const current = (day.activities || [])[replacementIndex];
    updateActivity(replacementIndex, { ...alternative, time: alternative.time || current?.time || "" });
    setReplacementIndex(null);
    setAlternatives([]);
    setReplacementStatus("");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.045] p-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/38">Editable Schedule</p>
          <p className="mt-1 text-sm text-white/64">{(day.activities || []).length} activities - estimated {form.currency_code} {(day.estimated_cost || 0).toFixed(2)}</p>
        </div>
        <p className="text-xs text-white/42">Changes are saved in the current trip workspace.</p>
      </div>

      {(day.activities || []).map((activity, index) => (
        <article key={`${day.day_number}-${index}-${activity.title}`} className="rounded-[24px] border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.055] p-4">
          <div className="grid gap-3 sm:grid-cols-[110px_1fr_120px]">
            <EditorInput label="Time" value={activity.time || ""} onChange={(value) => updateActivity(index, { time: value })} />
            <EditorInput label="Activity" value={activity.title} onChange={(value) => updateActivity(index, { title: value })} />
            <EditorInput
              label={`Cost (${form.currency_code})`}
              type="number"
              value={String(activity.estimated_cost || 0)}
              onChange={(value) => updateActivity(index, { estimated_cost: Math.max(0, Number(value) || 0) })}
            />
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-white/38">Description</span>
            <textarea
              rows={2}
              value={activity.description || ""}
              onChange={(event) => updateActivity(index, { description: event.target.value })}
              className="w-full resize-none rounded-2xl border border-[#3fb6c4]/12 bg-[#0e1518]/42 px-3 py-2 text-sm text-white outline-none focus:border-[#3fb6c4]/34"
            />
          </label>
          {activity.rank_reasons?.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {activity.rank_score ? <span className="rounded-full bg-[#3fb6c4] px-2.5 py-1 text-[11px] font-semibold text-[#06181a]">{activity.rank_score} match</span> : null}
              {activity.rank_reasons.map((reason) => <span key={reason} className="rounded-full border border-[#3fb6c4]/10 px-2.5 py-1 text-[11px] text-white/52">{reason}</span>)}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => loadAlternatives(index)} className="rounded-full bg-[#3fb6c4] px-3 py-1.5 text-sm font-medium text-[#06181a]">
              Replace
            </button>
            {allDays.filter((candidate) => candidate.day_number !== day.day_number).map((candidate) => (
              <button
                key={candidate.day_number}
                type="button"
                onClick={() => moveActivity(index, candidate.day_number)}
                className="rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.06] px-3 py-1.5 text-sm text-white/66 hover:bg-[#3fb6c4]/12"
              >
                Move to Day {candidate.day_number}
              </button>
            ))}
            <button type="button" onClick={() => deleteActivity(index)} className="rounded-full border border-red-200/14 bg-red-300/[0.07] px-3 py-1.5 text-sm text-red-50/70">
              Delete
            </button>
          </div>
        </article>
      ))}

      {replacementIndex !== null ? (
        <div className="rounded-[24px] border border-[#3fb6c4]/12 bg-[#0e1518]/52 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-white">Replacement options</p>
            <button type="button" onClick={() => setReplacementIndex(null)} className="text-sm text-white/52 hover:text-white">Cancel</button>
          </div>
          {loadingAlternatives ? <p className="mt-3 text-sm text-white/52">Searching local options...</p> : null}
          {replacementStatus ? <p className="mt-3 text-sm text-white/52">{replacementStatus}</p> : null}
          <div className="mt-3 grid gap-2">
            {alternatives.map((alternative) => (
              <button
                key={`${alternative.title}-${alternative.source_url || ""}`}
                type="button"
                onClick={() => chooseAlternative(alternative)}
                className="rounded-2xl border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.055] p-3 text-left transition hover:border-[#3fb6c4]/24 hover:bg-[#3fb6c4]/[0.1]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{alternative.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-white/52">{alternative.description}</p>
                  </div>
                  {alternative.rank_score ? <span className="rounded-full bg-[#3fb6c4] px-2 py-1 text-[10px] font-semibold text-[#06181a]">{alternative.rank_score}</span> : null}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EditorInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label>
      <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-white/38">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-2xl border border-[#3fb6c4]/12 bg-[#0e1518]/42 px-3 text-sm text-white outline-none focus:border-[#3fb6c4]/34"
      />
    </label>
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
        className="h-11 w-full rounded-2xl border border-[#3fb6c4]/14 bg-[#0e1518]/60 px-3 text-sm text-white outline-none transition placeholder:text-white/34 focus:border-[#3fb6c4]/38 focus:bg-[#0e1518]/75"
      />
    </label>
  );
}

function ResultPill({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-[24px] border border-[#3fb6c4]/12 bg-[#0e1518]/58 p-4 shadow-[0_16px_48px_rgba(0,0,0,0.18)]">
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

function structuredDayToDayPlan(day: StructuredDayData): DayPlan {
  const activityDetails = (day.activities || []).map((activity) => {
    const time = activity.time ? `${activity.time} - ` : "";
    const location = activity.location ? ` @ ${activity.location}` : "";
    const cost = activity.estimated_cost ? ` (${activity.estimated_cost.toFixed(2)})` : "";
    return `${time}${activity.title}${location}${cost}: ${activity.description || ""}`.trim();
  });
  const operationalDetails = [
    day.weather_note ? `Weather: ${day.weather_note}` : "",
    day.transit_note ? `Transit: ${day.transit_note}` : "",
    day.backup_plan ? `Backup: ${day.backup_plan}` : "",
  ].filter(Boolean);
  return {
    day: `Day ${day.day_number}`,
    title: day.title || formatDate(day.date),
    summary: day.summary || activityDetails[0] || "",
    bullets: activityDetails.slice(0, 5),
    details: [...activityDetails, ...operationalDetails],
  };
}

function recalculateStructuredDays(days: StructuredDayData[]) {
  return days
    .map((day) => {
      const activities = [...(day.activities || [])].sort((left, right) => {
        const leftTime = /^\d{1,2}:\d{2}$/.test(left.time || "") ? left.time || "" : "99:99";
        const rightTime = /^\d{1,2}:\d{2}$/.test(right.time || "") ? right.time || "" : "99:99";
        return leftTime.localeCompare(rightTime);
      });
      return {
        ...day,
        activities,
        estimated_cost: Number(
          activities.reduce((total, activity) => total + (Number(activity.estimated_cost) || 0), 0).toFixed(2)
        ),
      };
    })
    .sort((left, right) => left.day_number - right.day_number);
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
    price_insights: options?.price_insights || null,
    weather: options?.weather || null,
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
