import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, CloudDownload, Gauge, Heart, PlaneTakeoff, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, WalletCards, Wifi, WifiOff } from "lucide-react";

import { apiFetch, readApiJson } from "../../api/client";
import { ExactLedger } from "../expenses/ExactLedger";
import { WeatherMonitoring } from "./WeatherMonitoring";
import { Modal } from "../search/Modal";
import { listOfflinePacks, offlineGeneration, removeOfflinePack, saveOfflinePack } from "../offline/storage";
import type { BudgetExpense, BudgetGuardian, OfflineTripPack, RecommendationEvidence, SavedTrip, TripHealth } from "../../domain/travel";

type Constraint = "locked" | "preferred" | "optional" | "avoid";
type LiveEvent = "running_late" | "rain" | "tired" | "reduce_cost";
type CommandTab = "health" | "budget" | "offline" | "disruptions";
type LiveView = { status: string; date: string; day: Record<string, unknown> | null; next_activity: Record<string, unknown> | null; events: Array<{ id: LiveEvent; label: string }> };
type DisruptionScenario = { id: string; event: LiveEvent; strategy: "protect" | "balanced" | "rescue"; title: string; description: string; day_number: number; changes: string[]; before_score: number; after_score: number; changed: boolean; cost_delta: number; protected_commitments: number };

const tabs: Array<{ id: CommandTab; label: string; icon: ReactNode }> = [
  { id: "health", label: "Trip Health", icon: <Gauge size={15} /> },
  { id: "budget", label: "Budget Guardian", icon: <WalletCards size={15} /> },
  { id: "offline", label: "Offline Companion", icon: <CloudDownload size={15} /> },
  { id: "disruptions", label: "Disruption Autopilot", icon: <PlaneTakeoff size={15} /> },
];

export function TripIntelligencePanel({ trip, onClose, onTripUpdated }: { trip: SavedTrip | null; onClose: () => void; onTripUpdated: (trip: SavedTrip) => void }) {
  const [activeTab, setActiveTab] = useState<CommandTab>("health");
  const [health, setHealth] = useState<TripHealth | null>(null);
  const [live, setLive] = useState<LiveView | null>(null);
  const [budget, setBudget] = useState<BudgetGuardian | null>(null);
  const [constraints, setConstraints] = useState<Record<string, Constraint>>({});
  const [scenarios, setScenarios] = useState<DisruptionScenario[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<LiveEvent>("rain");
  const [offlinePack, setOfflinePack] = useState<OfflineTripPack | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [savingConstraint, setSavingConstraint] = useState("");
  const [savingFeedback, setSavingFeedback] = useState("");
  const [feedbackSent, setFeedbackSent] = useState<Record<string, string>>({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [expenseForm, setExpenseForm] = useState({ label: "", category: "Food", amount: "", paid_by: "Me", split_count: "1" });
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!trip) return;
    const controller = new AbortController();
    setLoading(true); setStatus(""); setScenarios([]); setFeedbackSent({});
    setOfflinePack(null);
    void listOfflinePacks().then(packs => { if (!controller.signal.aborted) setOfflinePack(packs.find(pack => String(pack.trip.id) === String(trip.id)) || null); }).catch(() => undefined);
    void apiFetch(`/api/trips/${trip.id}/intelligence`, { signal: controller.signal })
      .then((response) => readApiJson<{ health: TripHealth; live: LiveView; constraints: Record<string, Constraint>; budget: BudgetGuardian }>(response))
      .then((payload) => { setHealth(payload.health); setLive(payload.live); setConstraints(payload.constraints || {}); setBudget(payload.budget); })
      .catch((error) => { if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Could not load the command center."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [trip?.id, trip?.revision]);

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateConnection); window.addEventListener("offline", updateConnection);
    return () => { window.removeEventListener("online", updateConnection); window.removeEventListener("offline", updateConnection); };
  }, []);

  if (!trip) return null;
  const activities = ((live?.day as { activities?: Array<Record<string, unknown>> } | null)?.activities || []);
  const dayNumber = Number((live?.day as { day_number?: number } | null)?.day_number || 1);

  const saveConstraint = async (itemKey: string, value: Constraint) => {
    const previous = constraints; const next = { ...constraints, [itemKey]: value };
    setConstraints(next); setSavingConstraint(itemKey);
    try {
      const payload = await apiFetch(`/api/trips/${trip.id}/constraints`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ constraints: next, expected_revision: trip.revision }) }).then((response) => readApiJson<{ trip: SavedTrip; health: TripHealth }>(response));
      setHealth(payload.health); onTripUpdated(payload.trip); setStatus("Priority saved.");
    } catch (error) { setConstraints(previous); setStatus(error instanceof Error ? error.message : "Could not save priority."); }
    finally { setSavingConstraint(""); }
  };

  const sendFeedback = async (evidence: RecommendationEvidence, sentiment: "loved" | "disliked" | "skipped", tags: string[]) => {
    setSavingFeedback(evidence.item_key);
    try {
      await apiFetch(`/api/trips/${trip.id}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: evidence.title, sentiment, tags: tags.filter(Boolean) }) }).then((response) => readApiJson(response));
      setFeedbackSent((current) => ({ ...current, [evidence.item_key]: sentiment })); setStatus(`Feedback saved for ${evidence.title}.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not save feedback."); }
    finally { setSavingFeedback(""); }
  };

  const saveBudget = async (expenses: BudgetExpense[], reservePercent = budget?.reserve_percent || 10) => {
    setLoading(true);
    try {
      const payload = await apiFetch(`/api/trips/${trip.id}/budget`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expenses, reserve_percent: reservePercent, expected_revision: trip.revision }) }).then((response) => readApiJson<{ trip: SavedTrip; budget: BudgetGuardian }>(response));
      setBudget(payload.budget); onTripUpdated(payload.trip); setStatus("Budget Guardian updated.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not update the budget."); }
    finally { setLoading(false); }
  };

  const addExpense = async () => {
    const amount = Number(expenseForm.amount);
    if (!expenseForm.label.trim() || !Number.isFinite(amount) || amount <= 0 || !budget) { setStatus("Add an expense name and a positive amount."); return; }
    const expense: BudgetExpense = { id: crypto.randomUUID(), label: expenseForm.label.trim(), category: expenseForm.category, amount, paid_by: expenseForm.paid_by.trim() || "Me", split_count: Math.max(1, Number(expenseForm.split_count) || 1), occurred_at: new Date().toISOString().slice(0, 10) };
    await saveBudget([...budget.expenses, expense]); setExpenseForm((current) => ({ ...current, label: "", amount: "" }));
  };

  const prepareOffline = async () => {
    const generation = offlineGeneration();
    setLoading(true);
    try {
      const payload = await apiFetch(`/api/trips/${trip.id}/offline-pack`).then((response) => readApiJson<{ pack: OfflineTripPack }>(response));
      await saveOfflinePack(payload.pack, generation); setOfflinePack(payload.pack); setStatus("Offline trip pack saved on this device. Open /offline to read it without a connection.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not prepare this trip for offline use."); }
    finally { setLoading(false); }
  };

  const downloadOfflinePack = () => {
    if (!offlinePack) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(offlinePack, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${trip.destination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-offline-pack.json`; anchor.click(); URL.revokeObjectURL(url);
  };

  const analyzeDisruption = async (event: LiveEvent, affectedDay = dayNumber) => {
    setSelectedEvent(event); setLoading(true);
    try {
      const payload = await apiFetch(`/api/trips/${trip.id}/disruptions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, day_number: affectedDay, apply: false }) }).then((response) => readApiJson<{ scenarios: DisruptionScenario[] }>(response));
      setScenarios(payload.scenarios); setStatus("Three recovery paths are ready for review.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not generate recovery paths."); }
    finally { setLoading(false); }
  };

  const applyScenario = async (scenario: DisruptionScenario) => {
    setLoading(true);
    try {
      const payload = await apiFetch(`/api/trips/${trip.id}/disruptions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: scenario.event, strategy: scenario.strategy, day_number: scenario.day_number, apply: true, expected_revision: trip.revision }) }).then((response) => readApiJson<{ trip: SavedTrip; health: TripHealth; live: LiveView; budget: BudgetGuardian }>(response));
      onTripUpdated(payload.trip); setHealth(payload.health); setLive(payload.live); setBudget(payload.budget); setScenarios([]); setStatus(`${scenario.title} applied. Locked commitments were preserved.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not apply the recovery path."); }
    finally { setLoading(false); }
  };

  return <Modal label="Trip command center" onClose={onClose}>
    <div className="mx-auto w-full max-w-6xl rounded-[30px] border border-[#3fb6c4]/18 bg-[#0e1518]/96 p-4 shadow-[0_40px_130px_rgba(0,0,0,.6)] sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-medium uppercase tracking-[.18em] text-[#72d7dc]">Trip command center</p><h2 id={titleId} className="mt-2 text-3xl font-medium tracking-[-.04em] text-white">{trip.name}</h2><p className="mt-2 text-sm text-white/55">Protect the budget, prepare for weak signal, and recover intelligently when plans change.</p></div><button ref={closeButtonRef} type="button" onClick={onClose} className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/70">Close</button></div>
      <div role="tablist" aria-label="Trip command center" className="mt-6 grid grid-cols-2 gap-1 rounded-[20px] border border-white/8 bg-black/25 p-1.5 lg:grid-cols-4">{tabs.map((tab, index) => <button key={tab.id} id={`command-tab-${tab.id}`} aria-controls="command-panel" tabIndex={activeTab === tab.id ? 0 : -1} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} onKeyDown={event => { const target = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null; if (target !== null) { event.preventDefault(); setActiveTab(tabs[target].id); document.getElementById(`command-tab-${tabs[target].id}`)?.focus(); } }} className={`inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-3 text-xs transition sm:text-sm ${activeTab === tab.id ? "bg-[#3fb6c4] font-medium text-[#06181a]" : "text-white/75 hover:bg-white/5 hover:text-white"}`}>{tab.icon}{tab.label}</button>)}</div>
      <div id="command-panel" role="tabpanel" aria-labelledby={`command-tab-${activeTab}`}>
      {status ? <p role="status" aria-live="polite" className="mt-4 rounded-2xl border border-[#3fb6c4]/15 bg-[#3fb6c4]/8 px-4 py-3 text-sm text-white/70">{status}</p> : null}
      {loading && !health ? <p role="status" className="mt-8 text-white/60">Loading trip intelligence...</p> : null}
      {activeTab === "health" && health ? <HealthView health={health} activities={activities} dayNumber={dayNumber} constraints={constraints} savingConstraint={savingConstraint} savingFeedback={savingFeedback} feedbackSent={feedbackSent} destination={trip.destination} onConstraint={saveConstraint} onFeedback={sendFeedback} /> : null}
      {activeTab === "budget" ? <ExactLedger key={trip.id} trip={trip} onUpdated={onTripUpdated} /> : null}
      {activeTab === "offline" ? <><a href="/offline" className="mt-4 inline-flex min-h-11 items-center rounded-full border border-white/25 px-4 text-white">Open offline companion</a><OfflineView pack={offlinePack} isOnline={isOnline} busy={loading} onPrepare={prepareOffline} onDownload={downloadOfflinePack} onRemove={() => { void removeOfflinePack(trip.id).then(() => { setOfflinePack(null); setStatus("Offline copy removed from this device."); }).catch(() => setStatus("Could not remove the device copy. Please retry.")); }} /></> : null}
      {activeTab === "disruptions" ? <><WeatherMonitoring trip={trip} onUpdated={onTripUpdated} onPreview={(date) => { const day = trip.structuredItinerary?.days?.find(day => day.date === date); if (day) void analyzeDisruption("rain", day.day_number); else setStatus("That forecast date has no itinerary day to adjust."); }} /><DisruptionView events={live?.events || []} selectedEvent={selectedEvent} scenarios={scenarios} busy={loading} history={trip.disruptionHistory || []} onAnalyze={analyzeDisruption} onApply={applyScenario} /></> : null}
      </div>
    </div>
  </Modal>;
}

function HealthView({ health, activities, dayNumber, constraints, savingConstraint, savingFeedback, feedbackSent, destination, onConstraint, onFeedback }: { health: TripHealth; activities: Array<Record<string, unknown>>; dayNumber: number; constraints: Record<string, Constraint>; savingConstraint: string; savingFeedback: string; feedbackSent: Record<string, string>; destination: string; onConstraint: (key: string, value: Constraint) => void; onFeedback: (evidence: RecommendationEvidence, sentiment: "loved" | "disliked" | "skipped", tags: string[]) => void }) {
  return <div className="mt-6 grid gap-5 lg:grid-cols-[.72fr_1.28fr]">
    <section className="rounded-[28px] border border-[#3fb6c4]/14 bg-[#3fb6c4]/[.055] p-5"><div className="flex items-center gap-4"><div className="grid h-24 w-24 shrink-0 place-items-center rounded-full border-4 border-[#3fb6c4]/45 text-3xl font-semibold text-white">{health.score}</div><div><p className="text-xs uppercase tracking-[.16em] text-white/40">Trip Health</p><p className="mt-1 text-xl capitalize text-white">{health.grade.replace("_", " ")}</p><p className="mt-1 text-sm text-white/52">{health.summary}</p></div></div><div className="mt-5 space-y-2">{health.issues.slice(0, 8).map((issue) => <article key={issue.id} className="rounded-2xl border border-white/8 bg-black/20 p-3"><div className="flex items-center gap-2"><AlertTriangle size={14} className={issue.severity === "critical" ? "text-red-300" : issue.severity === "warning" ? "text-amber-200" : "text-white/45"}/><span className="text-[10px] uppercase tracking-[.14em] text-white/40">{issue.category}</span></div><p className="mt-2 text-sm text-white/75">{issue.message}</p><p className="mt-1 text-xs text-white/45">Repair: {issue.repair}</p></article>)}</div></section>
    <section className="rounded-[28px] border border-[#3fb6c4]/14 bg-black/20 p-5"><div className="flex items-center gap-2"><ShieldCheck size={17} className="text-[#3fb6c4]"/><h3 className="text-xl font-medium text-white">Commitments and evidence</h3></div><p className="mt-1 text-sm text-white/50">Lock what cannot move and teach Wanderful what belongs in your next trip.</p><div className="mt-5 space-y-3">{activities.map((activity, index) => { const evidence = health.evidence.find((item) => item.day_number === dayNumber && item.activity_index === index); const key = evidence?.item_key || `day-${dayNumber}-activity-${index + 1}`; const tags = [String(activity.period || "activity"), String(activity.location || ""), destination]; return <article key={key} className="rounded-2xl border border-white/8 bg-white/[.025] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-white/38">{String(activity.time || "Flexible")}</p><h4 className="mt-1 font-medium text-white">{String(activity.title || "Activity")}</h4></div><select aria-label={`Priority for ${String(activity.title || "activity")}`} value={constraints[key] || "optional"} disabled={savingConstraint === key} onChange={(event) => onConstraint(key, event.target.value as Constraint)} className="rounded-full border border-[#3fb6c4]/16 bg-[#0e1518] px-3 py-2 text-xs text-white"><option value="locked">Locked</option><option value="preferred">Preferred</option><option value="optional">Optional</option><option value="avoid">Avoid</option></select></div>{evidence ? <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/48"><span className="capitalize">{evidence.confidence} confidence</span><FeedbackButton label="Loved" active={feedbackSent[key] === "loved"} disabled={savingFeedback === key} onClick={() => onFeedback(evidence, "loved", tags)} icon={<Heart size={12}/>}/><FeedbackButton label="Skip" active={feedbackSent[key] === "skipped"} disabled={savingFeedback === key} onClick={() => onFeedback(evidence, "skipped", tags)}/></div> : null}</article>; })}</div></section>
  </div>;
}

function BudgetView({ budget, form, busy, onForm, onAdd, onRemove, onReserve }: { budget: BudgetGuardian; form: { label: string; category: string; amount: string; paid_by: string; split_count: string }; busy: boolean; onForm: (value: { label: string; category: string; amount: string; paid_by: string; split_count: string }) => void; onAdd: () => void; onRemove: (id: string) => void; onReserve: (value: number) => void }) {
  const money = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: budget.currency, maximumFractionDigits: 0 }).format(value);
  const used = budget.budget > 0 ? Math.min(100, Math.max(0, (budget.forecast / budget.budget) * 100)) : 0;
  return <div className="mt-6 space-y-5">
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Trip budget", budget.budget], ["Committed", budget.committed], ["Spent", budget.actual], ["Still available", budget.remaining]].map(([label, value]) => <div key={String(label)} className="rounded-[22px] border border-white/8 bg-white/[.025] p-4"><p className="text-[10px] uppercase tracking-[.15em] text-white/40">{label}</p><p className="mt-2 text-2xl font-medium text-white">{money(Number(value))}</p></div>)}</section>
    <section className="rounded-[28px] border border-[#3fb6c4]/14 bg-[#3fb6c4]/[.05] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-[.16em] text-white/40">Forecast pressure</p><h3 className="mt-1 text-xl font-medium capitalize text-white">{budget.status.replace("_", " ")}</h3></div><label className="text-xs text-white/55">Safety reserve <select value={budget.reserve_percent} onChange={(event) => onReserve(Number(event.target.value))} className="ml-2 rounded-full border border-white/10 bg-[#0e1518] px-3 py-2 text-white"><option value="5">5%</option><option value="10">10%</option><option value="15">15%</option><option value="20">20%</option></select></label></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-black/30"><div className={`h-full rounded-full ${used > 99 ? "bg-red-300" : used > 85 ? "bg-amber-200" : "bg-[#3fb6c4]"}`} style={{ width: `${used}%` }}/></div><div className="mt-3 flex justify-between text-xs text-white/45"><span>Forecast {money(budget.forecast)}</span><span>Protected reserve {money(budget.reserve)}</span></div>{budget.alerts.map((alert) => <p key={alert} className="mt-3 rounded-xl border border-amber-200/15 bg-amber-200/5 p-3 text-sm text-amber-100/80">{alert}</p>)}</section>
    <div className="grid gap-5 lg:grid-cols-[.85fr_1.15fr]"><section className="rounded-[28px] border border-white/8 bg-black/20 p-5"><h3 className="text-lg font-medium text-white">Record an expense</h3><div className="mt-4 grid gap-3 sm:grid-cols-2"><input aria-label="Expense name" placeholder="Dinner in Trastevere" value={form.label} onChange={(event) => onForm({ ...form, label: event.target.value })} className="rounded-2xl border border-white/10 bg-[#0e1518] px-4 py-3 text-sm text-white"/><input aria-label="Expense amount" type="number" min="0" step="0.01" placeholder="Amount" value={form.amount} onChange={(event) => onForm({ ...form, amount: event.target.value })} className="rounded-2xl border border-white/10 bg-[#0e1518] px-4 py-3 text-sm text-white"/><select aria-label="Expense category" value={form.category} onChange={(event) => onForm({ ...form, category: event.target.value })} className="rounded-2xl border border-white/10 bg-[#0e1518] px-4 py-3 text-sm text-white"><option>Food</option><option>Hotels</option><option>Flights</option><option>Transportation</option><option>Activities</option><option>Shopping</option><option>Other</option></select><input aria-label="Paid by" placeholder="Paid by" value={form.paid_by} onChange={(event) => onForm({ ...form, paid_by: event.target.value })} className="rounded-2xl border border-white/10 bg-[#0e1518] px-4 py-3 text-sm text-white"/></div><button type="button" disabled={busy} onClick={onAdd} className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#3fb6c4] px-4 py-2.5 text-sm font-medium text-[#06181a] disabled:opacity-50"><Plus size={15}/>Add expense</button></section>
      <section className="rounded-[28px] border border-white/8 bg-black/20 p-5"><h3 className="text-lg font-medium text-white">Plan versus reality</h3><div className="mt-4 space-y-2">{budget.breakdown.map((item) => <div key={item.category} className="grid grid-cols-[1fr_auto_auto] gap-3 rounded-xl bg-white/[.03] px-3 py-2.5 text-sm"><span className="text-white/70">{item.category}</span><span className="text-white/42">{money(item.planned)} planned</span><span className={item.variance < 0 ? "text-amber-200" : "text-[#7addd7]"}>{money(item.actual)}</span></div>)}</div>{budget.expenses.length ? <div className="mt-5 border-t border-white/8 pt-4"><p className="text-xs uppercase tracking-[.14em] text-white/38">Recent expenses</p>{budget.expenses.slice().reverse().slice(0, 8).map((expense) => <div key={expense.id} className="mt-2 flex items-center justify-between gap-3 text-sm"><span className="text-white/65">{expense.label}<span className="ml-2 text-xs text-white/35">{expense.category}</span></span><span className="flex items-center gap-2 text-white">{money(expense.amount)}<button type="button" aria-label={`Delete ${expense.label}`} onClick={() => onRemove(expense.id)} className="rounded-full p-1 text-white/35 hover:text-red-200"><Trash2 size={13}/></button></span></div>)}</div> : <p className="mt-5 text-sm text-white/42">No actual spending recorded yet.</p>}</section></div>
  </div>;
}

function OfflineView({ pack, isOnline, busy, onPrepare, onDownload, onRemove }: { pack: OfflineTripPack | null; isOnline: boolean; busy: boolean; onPrepare: () => void; onDownload: () => void; onRemove: () => void }) {
  return <div className="mt-6 grid gap-5 lg:grid-cols-[.85fr_1.15fr]"><section className="rounded-[28px] border border-[#3fb6c4]/14 bg-[#3fb6c4]/[.05] p-6"><div className="flex items-center gap-3">{isOnline ? <Wifi className="text-[#72d7dc]"/> : <WifiOff className="text-amber-200"/>}<div><p className="text-xs uppercase tracking-[.16em] text-white/40">Connection</p><p className="text-lg font-medium text-white">{isOnline ? "Online and ready to sync" : "Offline mode active"}</p></div></div><h3 className="mt-7 text-2xl font-medium tracking-[-.03em] text-white">Carry the important parts of your trip.</h3><p className="mt-2 text-sm leading-6 text-white/52">Store the day plan, addresses, selected bookings, logistics, packing notes, and recovery details directly on this device.</p><button type="button" disabled={busy || !isOnline} onClick={onPrepare} className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#3fb6c4] px-5 py-3 text-sm font-medium text-[#06181a] disabled:opacity-45"><CloudDownload size={16}/>{pack ? "Refresh offline copy" : "Prepare for offline"}</button></section><section className="rounded-[28px] border border-white/8 bg-black/20 p-6">{pack ? <><div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.16em] text-[#72d7dc]">Available offline</p><h3 className="mt-2 text-xl font-medium text-white">{pack.trip.destination} trip pack</h3></div><Check className="text-[#72d7dc]"/></div><div className="mt-6 grid grid-cols-2 gap-3"><OfflineStat label="Itinerary items" value={String(pack.item_count)}/><OfflineStat label="Trip days" value={String(pack.days.length)}/><OfflineStat label="Pack version" value={`v${pack.version}`}/><OfflineStat label="Integrity" value={pack.checksum.slice(0, 8)}/></div><p className="mt-5 text-xs text-white/38">Updated {new Date(pack.generated_at).toLocaleString()}</p><div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={onDownload} className="rounded-full border border-[#3fb6c4]/20 bg-[#3fb6c4]/10 px-4 py-2 text-sm text-white/75">Export backup</button><button type="button" onClick={onRemove} className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/50">Remove from device</button></div></> : <div className="grid min-h-[290px] place-items-center text-center"><div><CloudDownload size={34} className="mx-auto text-white/25"/><h3 className="mt-4 text-lg font-medium text-white">No offline copy yet</h3><p className="mt-2 max-w-sm text-sm text-white/45">Prepare the trip once while connected. Wanderful will keep the pack available in this browser.</p></div></div>}</section></div>;
}

function DisruptionView({ events, selectedEvent, scenarios, busy, history, onAnalyze, onApply }: { events: Array<{ id: LiveEvent; label: string }>; selectedEvent: LiveEvent; scenarios: DisruptionScenario[]; busy: boolean; history: SavedTrip["disruptionHistory"]; onAnalyze: (event: LiveEvent) => void; onApply: (scenario: DisruptionScenario) => void }) {
  return <div className="mt-6"><section className="rounded-[28px] border border-[#3fb6c4]/14 bg-[#3fb6c4]/[.05] p-5"><div className="flex items-center gap-2"><RefreshCw size={17} className="text-[#72d7dc]"/><h3 className="text-xl font-medium text-white">What changed?</h3></div><p className="mt-2 text-sm text-white/50">Autopilot preserves locked commitments and offers three reversible recovery strategies.</p><div className="mt-4 flex flex-wrap gap-2">{events.map((event) => <button key={event.id} type="button" disabled={busy} onClick={() => onAnalyze(event.id)} className={`rounded-full border px-4 py-2 text-sm transition disabled:opacity-45 ${selectedEvent === event.id && scenarios.length ? "border-[#3fb6c4]/50 bg-[#3fb6c4]/18 text-white" : "border-white/10 bg-black/15 text-white/65"}`}>{event.label}</button>)}</div></section>{scenarios.length ? <div className="mt-5 grid gap-4 lg:grid-cols-3">{scenarios.map((scenario, index) => <article key={scenario.id} className={`rounded-[26px] border p-5 ${index === 1 ? "border-[#3fb6c4]/35 bg-[#3fb6c4]/[.08]" : "border-white/8 bg-black/20"}`}><p className="text-[10px] uppercase tracking-[.16em] text-[#72d7dc]">{scenario.strategy}</p><h4 className="mt-2 text-xl font-medium text-white">{scenario.title}</h4><p className="mt-1 text-sm text-white/45">{scenario.description}</p><div className="mt-4 flex gap-3 text-xs text-white/45"><span>Health {scenario.before_score} to {scenario.after_score}</span><span>{scenario.protected_commitments} locked</span></div><div className="mt-4 space-y-2">{scenario.changes.map((change) => <p key={change} className="text-sm leading-5 text-white/65">• {change}</p>)}</div><p className={`mt-4 text-sm ${scenario.cost_delta <= 0 ? "text-[#7addd7]" : "text-amber-200"}`}>{scenario.cost_delta === 0 ? "No estimated cost change" : `Estimated cost change ${scenario.cost_delta > 0 ? "+" : ""}${scenario.cost_delta}`}</p><button type="button" disabled={busy || !scenario.changed} onClick={() => onApply(scenario)} className={`mt-5 w-full rounded-full px-4 py-2.5 text-sm font-medium disabled:opacity-40 ${index === 1 ? "bg-[#3fb6c4] text-[#06181a]" : "border border-white/12 text-white/70"}`}>Apply this recovery</button></article>)}</div> : <div className="mt-5 grid min-h-[220px] place-items-center rounded-[28px] border border-dashed border-white/10 bg-black/10 text-center"><div><Sparkles size={28} className="mx-auto text-white/25"/><p className="mt-3 text-white/65">Select a disruption to generate recovery paths.</p></div></div>}{history?.length ? <section className="mt-5 rounded-[24px] border border-white/8 bg-black/20 p-5"><p className="text-xs uppercase tracking-[.16em] text-white/38">Recovery history</p>{history.slice(0, 4).map((item) => <div key={item.applied_at} className="mt-3 flex flex-wrap justify-between gap-2 text-sm"><span className="text-white/65">{item.title}</span><time className="text-white/35">{new Date(item.applied_at).toLocaleString()}</time></div>)}</section> : null}</div>;
}

function OfflineStat({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-white/[.035] p-3"><p className="text-[10px] uppercase tracking-[.13em] text-white/35">{label}</p><p className="mt-1 text-lg text-white">{value}</p></div>; }
function FeedbackButton({ label, active, disabled, onClick, icon }: { label: string; active: boolean; disabled: boolean; onClick: () => void; icon?: ReactNode }) { return <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick} className={`rounded-full border px-3 py-1.5 text-xs disabled:opacity-50 ${active ? "border-[#70d6df]/50 bg-[#3fb6c4]/18 text-white" : "border-white/10 text-white/60"}`}>{icon ? <span className="mr-1 inline-flex align-middle">{icon}</span> : null}{label}</button>; }
