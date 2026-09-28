import { useEffect, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { apiFetch, readApiJson } from "../../api/client";
import { Modal } from "../search/Modal";
import { field, message, primary, type PersonalPreferences } from "./types";

export function PreferencesButton() {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="action-button" onClick={() => setOpen(true)}><SlidersHorizontal size={16} /> Travel preferences</button>{open && <PreferencesDialog onClose={() => setOpen(false)} />}</>;
}
function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState<PersonalPreferences | null>(null);
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch("/api/travel-preferences", { signal: controller.signal }).then(readApiJson<{ preferences: PersonalPreferences; revision: number }>).then(data => { setValue(data.preferences); setRevision(data.revision); setError(""); }).catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [retry]);
  const groups = [{ key: "pace", label: "Your rhythm", choices: ["relaxed", "balanced", "packed"] }, { key: "walking", label: "Walking tolerance", choices: ["low", "moderate", "high"] }, { key: "flight_time", label: "Preferred departure", choices: ["any", "morning", "afternoon", "evening"] }, { key: "stay_priority", label: "What matters in a stay?", choices: ["location", "value", "comfort"] }] as const;
  return <Modal label="Personal travel preferences" onClose={onClose}><section className="w-full max-w-2xl rounded-[28px] border border-[#91e4db]/30 bg-[#0d2026] p-5 shadow-2xl sm:p-8" onClick={e => e.stopPropagation()}>
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.2em] text-[#91e4db]">Made for you</p><h2 className="mt-2 text-3xl">Your kind of travel.</h2></div><button aria-label="Close preferences" className="action-button" onClick={onClose}><X size={20} /></button></div>
    <p className="mt-3 text-sm text-slate-300">Defaults for future plans. Your current trip stays unchanged.</p>
    {error && <p role="alert" className="my-4 text-amber-100">{error} {!value && <button className="underline" onClick={() => setRetry(n => n + 1)}>Retry</button>}</p>}
    {!value ? <p className="mt-5">Loading preferences…</p> : <form className="mt-6 space-y-5" onSubmit={async e => { e.preventDefault(); e.stopPropagation(); setBusy(true); setError(""); try { await readApiJson(await apiFetch("/api/travel-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: value, expected_revision: revision }) })); onClose(); } catch (e) { setError(message(e)); } finally { setBusy(false); } }}>
      <div className="grid gap-5 sm:grid-cols-2">{groups.map(group => <fieldset key={group.key}><legend className="mb-2 text-sm text-slate-200">{group.label}</legend><div className="flex flex-wrap gap-2">{group.choices.map(choice => <label key={choice} className={`cursor-pointer rounded-xl border px-3 py-3 text-sm capitalize ${value[group.key] === choice ? "border-[#91e4db] bg-[#214940] text-white" : "border-white/20 text-slate-200"}`}><input className="mr-2 accent-[#91e4db]" type="radio" name={group.key} value={choice} checked={value[group.key] === choice} onChange={() => setValue({ ...value, [group.key]: choice })} />{choice}</label>)}</div></fieldset>)}</div>
      <label className="block text-sm">Interests & personal priorities<textarea className={field} maxLength={600} value={value.interests} placeholder="Local food, quiet mornings, architecture…" onChange={e => setValue({ ...value, interests: e.target.value })} /></label>
      <button className={primary} disabled={busy}>{busy ? "Saving…" : "Save preferences"}</button>
    </form>}
  </section></Modal>;
}
