import { useEffect, useRef, useState } from "react";
import { apiFetch, readApiJson } from "../../api/client";
import type { SavedTrip } from "../../domain/travel";

type RecordItem = { id: string; kind: string; name?: string; label?: string; category?: string; amount_minor?: number; paid_by_id?: string; split_ids?: string[]; from_id?: string; to_id?: string; commitment_id?: string };
type Ledger = { currency: string; exponent: number; revision: number; planned_minor: number; confirmed_minor: number; paid_minor: number; remaining_expected_minor: number; budget_remaining_minor: number; records: RecordItem[]; commitments: RecordItem[]; balances: Record<string, number>; warnings: string[] };

export function ExactLedger({ trip, onUpdated }: { trip: SavedTrip; onUpdated: (trip: SavedTrip) => void }) {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [form, setForm] = useState({ label: "", amount: "", paid_by_id: "", split_ids: null as string[] | null, commitment_id: "", category: "Food" });
  const pendingId = useRef(crypto.randomUUID());
  const memberId = useRef(crypto.randomUUID());
  const settlementIds = useRef<Record<string, string>>({});
  const refresh = async (signal?: AbortSignal) => {
    try { const payload = await apiFetch(`/api/trips/${trip.id}/ledger`, { signal }).then(response => readApiJson<{ ledger: Ledger }>(response)); setLedger(payload.ledger); setError(""); }
    catch (caught) { if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "Could not load ledger."); }
  };
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [trip.id, trip.revision]);
  const members = ledger?.records.filter(item => item.kind === "member") || [];
  const money = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: ledger?.currency || "USD" }).format(value / 10 ** (ledger?.exponent ?? 2));
  const mutate = async (body: Record<string, unknown>, remove?: string) => {
    if (!ledger || busy) return false;
    setBusy(true); setError("");
    try {
      const response = await apiFetch(`/api/trips/${trip.id}/records${remove ? `/${remove}` : ""}`, { method: remove ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, expected_revision: ledger.revision, currency: ledger.currency }) });
      const payload = await readApiJson<{ ledger: Ledger; trip: SavedTrip }>(response);
      setLedger(payload.ledger); onUpdated(payload.trip); return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save. Your draft is retained."); return false; }
    finally { setBusy(false); }
  };
  const payer = form.paid_by_id || members[0]?.id || "";
  const splits = form.split_ids ?? members.map(member => member.id);
  const debts: { from: string; to: string; amount: number }[] = [];
  const debtors = Object.entries(ledger?.balances || {}).filter(([, value]) => value < 0).map(([id, value]) => ({ id, amount: -value }));
  const creditors = Object.entries(ledger?.balances || {}).filter(([, value]) => value > 0).map(([id, value]) => ({ id, amount: value }));
  let debtor = 0, creditor = 0;
  while (debtor < debtors.length && creditor < creditors.length) {
    const amount = Math.min(debtors[debtor].amount, creditors[creditor].amount);
    debts.push({ from: debtors[debtor].id, to: creditors[creditor].id, amount });
    debtors[debtor].amount -= amount; creditors[creditor].amount -= amount;
    if (!debtors[debtor].amount) debtor++; if (!creditors[creditor].amount) creditor++;
  }
  const memberName = (id: string) => members.find(member => member.id === id)?.name || "Member";
  return <section aria-label="Trip money ledger" className="mt-6 space-y-5 text-white">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-2xl">Every cost, counted once.</h3><p className="mt-1 text-sm text-white/75">One trip currency. Payments can link to a confirmed booking.</p></div><button onClick={() => void refresh()} disabled={busy} className="min-h-11 rounded-full border border-white/25 px-4">Refresh ledger</button></header>
    {error && <p role="alert" className="rounded-2xl border border-amber-200/30 p-4 text-amber-100">{error} Your draft is retained.</p>}
    {ledger && <><div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[["Planned", ledger.planned_minor], ["Confirmed", ledger.confirmed_minor], ["Paid", ledger.paid_minor], ["Still expected", ledger.remaining_expected_minor], ["Budget remaining", ledger.budget_remaining_minor]].map(([label, amount]) => <div key={String(label)} className="rounded-2xl border border-[#72d7dc]/20 bg-[#72d7dc]/5 p-4"><p className="text-xs text-white/75">{label}</p><p className="mt-2 text-xl">{money(Number(amount))}</p></div>)}</div>
    {ledger.warnings.map((warning, index) => <p key={index} className="text-sm text-amber-100">{warning}</p>)}
    <div className="grid gap-5 lg:grid-cols-2"><div className="space-y-5"><section className="expense-panel rounded-3xl p-5"><h4 className="text-lg">Your group</h4><div className="my-4 flex flex-wrap gap-2">{members.map(member => <span key={member.id} className="rounded-full border border-[#72d7dc]/25 px-4 py-2 text-sm">{member.name}</span>)}</div><div className="flex gap-2"><input aria-label="New member name" value={name} onChange={event => setName(event.target.value)} className="expense-input" placeholder="Traveler name" /><button disabled={busy || !name.trim()} onClick={async () => { if (await mutate({ id: memberId.current, kind: "member", name })) { setName(""); memberId.current = crypto.randomUUID(); } }} className="min-h-11 rounded-full bg-[#72d7dc] px-5 text-[#06181a] disabled:opacity-50">Add</button></div></section>
    <section className="expense-panel rounded-3xl p-5"><h4 className="text-lg">Record a payment</h4><div className="mt-4 grid gap-3"><input aria-label="Payment description" value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} className="expense-input" placeholder="Dinner by the river" /><input aria-label="Payment amount" inputMode="decimal" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} className="expense-input" placeholder={`Amount in ${ledger.currency}`} /><label className="text-sm text-white/75">Paid by<select aria-label="Payment payer" value={payer} onChange={event => setForm({ ...form, paid_by_id: event.target.value })} className="expense-input">{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label className="text-sm text-white/75">Category<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} className="expense-input">{["Food", "Hotels", "Flights", "Transportation", "Activities", "Other"].map(category => <option key={category}>{category}</option>)}</select></label><label className="text-sm text-white/75">Link to booking<select aria-label="Payment commitment" value={form.commitment_id} onChange={event => setForm({ ...form, commitment_id: event.target.value })} className="expense-input"><option value="">Separate expense</option>{ledger.commitments.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><fieldset><legend className="mb-2 text-sm text-white/75">Split between</legend><div className="flex flex-wrap gap-2">{members.map(member => <label key={member.id} className="flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-3 text-sm"><input type="checkbox" checked={splits.includes(member.id)} onChange={event => setForm({ ...form, split_ids: event.target.checked ? [...splits, member.id] : splits.filter(id => id !== member.id) })} />{member.name}</label>)}</div></fieldset><button disabled={busy || !form.amount || !form.label.trim() || !splits.length} onClick={async () => { if (await mutate({ id: pendingId.current, kind: "expense", ...form, paid_by_id: payer, split_ids: splits })) { setForm({ ...form, amount: "", label: "" }); pendingId.current = crypto.randomUUID(); } }} className="min-h-11 rounded-full bg-[#72d7dc] px-5 text-[#06181a] disabled:opacity-50">Record payment</button></div></section></div>
    <div className="space-y-5"><section className="settlement-card rounded-3xl p-5"><h4 className="text-xl">Settle up</h4>{!debts.length && <p className="mt-4 text-white/75">All settled.</p>}{debts.map(debt => <div key={`${debt.from}-${debt.to}`} className="mt-3 rounded-2xl border border-white/20 p-4"><p>{memberName(debt.from)} → {memberName(debt.to)} · {money(debt.amount)}</p><button disabled={busy} onClick={async () => { const key = `${debt.from}-${debt.to}-${debt.amount}`; settlementIds.current[key] ||= crypto.randomUUID(); await mutate({ id: settlementIds.current[key], kind: "settlement", from_id: debt.from, to_id: debt.to, amount: (debt.amount / 10 ** ledger.exponent).toFixed(ledger.exponent) }); }} className="mt-3 min-h-11 rounded-full border border-amber-200/30 px-4 text-amber-100">Record settlement</button></div>)}</section>
    <section className="expense-panel rounded-3xl p-5"><h4 className="text-xl">Recorded activity</h4>{ledger.records.filter(item => ["expense", "settlement"].includes(item.kind)).map(item => <div key={item.id} className="mt-3 flex items-center justify-between gap-3 border-t border-white/15 pt-3"><div><p>{item.label || (item.kind === "settlement" ? "Settlement" : "Payment")}</p><p className="text-sm text-white/75">{money(item.amount_minor || 0)}{item.commitment_id ? " · Linked to booking" : ""}</p></div><button disabled={busy} aria-label={`Delete ${item.kind} ${item.label || item.id}`} onClick={() => { if (window.confirm(`Delete this ${item.kind}? This is not an itinerary undo.`)) void mutate({}, item.id); }} className="min-h-11 rounded-full border border-white/20 px-4 text-sm">Delete</button></div>)}</section></div></div></>}
  </section>;
}
