import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Check, Plus, ReceiptText, Sparkles, Trash2, UserPlus, Users, WalletCards, X } from "lucide-react";

import { apiFetch, readApiJson } from "../../api/client";
import type { BudgetExpense, BudgetGuardian, BudgetState, GroupSettlement, SavedTrip } from "../../domain/travel";

type Debt = { from: string; to: string; amount: number };

export function GroupExpensesPanel({ trip, onClose, onTripUpdated }: { trip: SavedTrip | null; onClose: () => void; onTripUpdated: (trip: SavedTrip) => void }) {
  const [members, setMembers] = useState<string[]>([]);
  const [expenses, setExpenses] = useState<BudgetExpense[]>([]);
  const [settlements, setSettlements] = useState<GroupSettlement[]>([]);
  const [reservePercent, setReservePercent] = useState(10);
  const [memberName, setMemberName] = useState("");
  const [form, setForm] = useState({ label: "", amount: "", category: "Food", paidBy: "", splitBetween: [] as string[] });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!trip) return;
    const state = trip.budgetState || {};
    const nextMembers = state.members?.length ? state.members : ["Me"];
    setMembers(nextMembers);
    setExpenses(state.expenses || []);
    setSettlements(state.settlements || []);
    setReservePercent(state.reserve_percent || 10);
    setForm((current) => ({ ...current, paidBy: nextMembers[0], splitBetween: nextMembers }));
    setStatus("");
  }, [trip?.id]);

  useEffect(() => {
    if (!trip) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); };
  }, [trip, onClose]);

  const debts = useMemo(() => calculateDebts(members, expenses, settlements), [expenses, members, settlements]);
  const currency = trip?.form.currency_code || trip?.structuredItinerary?.currency_code || "USD";
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  if (!trip) return null;

  const persist = async (next: BudgetState, success: string) => {
    setBusy(true); setStatus("");
    try {
      const payload = await apiFetch(`/api/trips/${trip.id}/budget`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reserve_percent: reservePercent, members, expenses, settlements, ...next }) }).then((response) => readApiJson<{ trip: SavedTrip; budget: BudgetGuardian }>(response));
      const state = payload.trip.budgetState || {};
      setMembers(state.members || members); setExpenses(state.expenses || []); setSettlements(state.settlements || []);
      onTripUpdated(payload.trip); setStatus(success);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not update group expenses."); }
    finally { setBusy(false); }
  };

  const addMember = async () => {
    const name = memberName.trim();
    if (!name || members.some((member) => member.toLowerCase() === name.toLowerCase())) return;
    const nextMembers = [...members, name];
    setMemberName("");
    setForm((current) => ({ ...current, splitBetween: [...current.splitBetween, name] }));
    await persist({ members: nextMembers }, `${name} joined the group.`);
  };

  const addExpense = async () => {
    const amount = Number(form.amount);
    if (!form.label.trim() || !Number.isFinite(amount) || amount <= 0 || !form.paidBy || !form.splitBetween.length) {
      setStatus("Add a name, amount, payer, and at least one person to split with."); return;
    }
    const expense: BudgetExpense = { id: crypto.randomUUID(), label: form.label.trim(), category: form.category, amount, paid_by: form.paidBy, split_count: form.splitBetween.length, split_between: form.splitBetween, occurred_at: new Date().toISOString().slice(0, 10) };
    await persist({ expenses: [...expenses, expense] }, "Expense added and balances recalculated.");
    setForm((current) => ({ ...current, label: "", amount: "" }));
  };

  const settle = async (debt: Debt) => {
    const settlement: GroupSettlement = { id: crypto.randomUUID(), from: debt.from, to: debt.to, amount: debt.amount, settled_at: new Date().toISOString().slice(0, 10) };
    await persist({ settlements: [...settlements, settlement] }, `${debt.from} and ${debt.to} are settled.`);
  };

  return <div className="fixed inset-0 z-[110] overflow-auto bg-[#071012]/92 px-3 py-5 backdrop-blur-xl sm:px-5 sm:py-8" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="mx-auto max-w-6xl overflow-hidden rounded-[34px] border border-[#72d7dc]/16 bg-[#0b1517] shadow-[0_45px_150px_rgba(0,0,0,.68)]" onClick={(event) => event.stopPropagation()}>
      <header className="expense-hero relative overflow-hidden border-b border-white/8 px-5 py-6 sm:px-8 sm:py-8">
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-5">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#79ded9]">Group expenses</p><h2 id={titleId} className="mt-2 text-3xl font-medium tracking-[-.045em] text-white sm:text-5xl">Split the trip, not the mood.</h2><p className="mt-3 text-sm text-white/48">{trip.name} · {members.length} travelers</p></div>
          <button ref={closeRef} type="button" aria-label="Close group expenses" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-black/20 text-white/65 hover:text-white"><X size={18}/></button>
        </div>
        <div className="relative z-10 mt-7 grid gap-3 sm:grid-cols-3">
          <Stat label="Group spend" value={money(total, currency)} icon={<ReceiptText size={17}/>} />
          <Stat label="Expenses" value={`${expenses.length}`} icon={<WalletCards size={17}/>} />
          <Stat label="Open balances" value={`${debts.length}`} icon={<Users size={17}/>} />
        </div>
      </header>

      <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[.9fr_1.1fr] lg:p-8">
        <div className="space-y-5">
          <section className="expense-panel rounded-[28px] p-5">
            <div className="flex items-center justify-between gap-3"><div><p className="section-kicker">Your group</p><h3 className="mt-1 text-xl font-medium text-white">Travelers</h3></div><span className="grid h-10 w-10 place-items-center rounded-full bg-[#72d7dc]/12 text-[#72d7dc]"><Users size={18}/></span></div>
            <div className="mt-4 flex flex-wrap gap-2">{members.map((member, index) => <span key={member} className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[.045] py-1.5 pl-1.5 pr-3 text-sm text-white/72"><span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold text-[#071012] ${avatarColor(index)}`}>{initials(member)}</span>{member}</span>)}</div>
            <div className="mt-4 flex gap-2"><input aria-label="Traveler name" value={memberName} onChange={(event) => setMemberName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addMember(); }} placeholder="Add a traveler" className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/18 px-4 py-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#72d7dc]/35"/><button type="button" disabled={busy || !memberName.trim()} onClick={() => void addMember()} className="grid h-12 w-12 place-items-center rounded-2xl bg-[#72d7dc] text-[#06181a] disabled:opacity-40"><UserPlus size={17}/></button></div>
          </section>

          <section className="expense-panel rounded-[28px] p-5">
            <p className="section-kicker">New expense</p><h3 className="mt-1 text-xl font-medium text-white">Who paid?</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><input aria-label="Expense description" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Dinner by the river" className="expense-input sm:col-span-2"/><input aria-label="Expense amount" type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0.00" className="expense-input"/><select aria-label="Expense category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="expense-input"><option>Food</option><option>Hotels</option><option>Flights</option><option>Transportation</option><option>Activities</option><option>Shopping</option><option>Other</option></select><select aria-label="Paid by" value={form.paidBy} onChange={(event) => setForm({ ...form, paidBy: event.target.value })} className="expense-input sm:col-span-2">{members.map((member) => <option key={member}>{member}</option>)}</select></div>
            <p className="mt-4 text-xs font-medium uppercase tracking-[.14em] text-white/36">Split between</p>
            <div className="mt-2 flex flex-wrap gap-2">{members.map((member) => { const selected = form.splitBetween.includes(member); return <button key={member} type="button" aria-pressed={selected} onClick={() => setForm((current) => ({ ...current, splitBetween: selected ? current.splitBetween.filter((item) => item !== member) : [...current.splitBetween, member] }))} className={`rounded-full border px-3 py-1.5 text-xs ${selected ? "border-[#72d7dc]/40 bg-[#72d7dc]/15 text-white" : "border-white/8 text-white/38"}`}>{selected ? <Check size={11} className="mr-1 inline"/> : null}{member}</button>; })}</div>
            <button type="button" disabled={busy} onClick={() => void addExpense()} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#72d7dc] px-5 py-3 text-sm font-semibold text-[#06181a] disabled:opacity-45"><Plus size={15}/>Add expense</button>
          </section>
        </div>

        <div className="space-y-5">
          <section className="settlement-card rounded-[28px] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3"><div><p className="section-kicker">Settle up</p><h3 className="mt-1 text-2xl font-medium text-white">Keep it simple.</h3></div><Sparkles size={20} className="text-[#f1bf75]"/></div>
            {debts.length ? <div className="mt-5 space-y-3">{debts.map((debt) => <article key={`${debt.from}-${debt.to}`} className="flex flex-wrap items-center justify-between gap-4 rounded-[22px] border border-white/8 bg-black/18 p-4"><div className="flex min-w-0 items-center gap-3"><Avatar name={debt.from} index={members.indexOf(debt.from)}/><div className="min-w-0"><p className="truncate font-medium text-white">{debt.from} <ArrowRight size={13} className="mx-1 inline text-white/30"/> {debt.to}</p><p className="mt-1 text-sm text-white/42">owes {money(debt.amount, currency)}</p></div></div><button type="button" disabled={busy} onClick={() => void settle(debt)} className="rounded-full border border-[#72d7dc]/22 bg-[#72d7dc]/10 px-4 py-2 text-xs font-medium text-[#8fe6e1] hover:bg-[#72d7dc]/16">Mark settled</button></article>)}</div> : <div className="mt-5 grid min-h-40 place-items-center rounded-[22px] border border-dashed border-[#72d7dc]/15 bg-[#72d7dc]/[.035] text-center"><div><Check size={25} className="mx-auto text-[#72d7dc]"/><p className="mt-2 font-medium text-white">All settled</p><p className="mt-1 text-sm text-white/40">No one owes anything right now.</p></div></div>}
          </section>

          <section className="expense-panel rounded-[28px] p-5 sm:p-6"><div className="flex items-center justify-between"><div><p className="section-kicker">Activity</p><h3 className="mt-1 text-xl font-medium text-white">Recent expenses</h3></div><span className="text-sm text-white/38">{money(total, currency)}</span></div>{expenses.length ? <div className="mt-4 divide-y divide-white/6">{[...expenses].reverse().slice(0, 12).map((expense) => <div key={expense.id} className="flex items-center justify-between gap-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-white/82">{expense.label}</p><p className="mt-1 text-xs text-white/36">{expense.paid_by} paid · split {expense.split_between?.length || expense.split_count} ways</p></div><div className="flex shrink-0 items-center gap-2"><span className="font-medium text-white">{money(expense.amount, currency)}</span><button type="button" aria-label={`Delete ${expense.label}`} disabled={busy} onClick={() => void persist({ expenses: expenses.filter((item) => item.id !== expense.id) }, "Expense removed.")} className="rounded-full p-2 text-white/25 hover:bg-red-400/10 hover:text-red-200"><Trash2 size={14}/></button></div></div>)}</div> : <p className="mt-5 text-sm text-white/40">Add the first shared expense to start balancing the group.</p>}</section>
        </div>
      </div>
      {status ? <div role="status" className="border-t border-white/8 px-6 py-3 text-center text-sm text-[#9de4df]">{status}</div> : null}
    </div>
  </div>;
}

function calculateDebts(members: string[], expenses: BudgetExpense[], settlements: GroupSettlement[]): Debt[] {
  const balances = Object.fromEntries(members.map((member) => [member, 0])) as Record<string, number>;
  expenses.forEach((expense) => {
    const split = expense.split_between?.filter((member) => members.includes(member)) || members.slice(0, Math.max(1, expense.split_count));
    if (!split.length) return;
    balances[expense.paid_by] = (balances[expense.paid_by] || 0) + expense.amount;
    const share = expense.amount / split.length;
    split.forEach((member) => { balances[member] = (balances[member] || 0) - share; });
  });
  settlements.forEach((item) => { balances[item.from] = (balances[item.from] || 0) + item.amount; balances[item.to] = (balances[item.to] || 0) - item.amount; });
  const debtors = Object.entries(balances).filter(([, value]) => value < -0.005).map(([name, value]) => ({ name, amount: -value })).sort((a, b) => b.amount - a.amount);
  const creditors = Object.entries(balances).filter(([, value]) => value > 0.005).map(([name, value]) => ({ name, amount: value })).sort((a, b) => b.amount - a.amount);
  const debts: Debt[] = []; let debtor = 0; let creditor = 0;
  while (debtor < debtors.length && creditor < creditors.length) {
    const amount = Math.min(debtors[debtor].amount, creditors[creditor].amount);
    if (amount > 0.005) debts.push({ from: debtors[debtor].name, to: creditors[creditor].name, amount: Math.round(amount * 100) / 100 });
    debtors[debtor].amount -= amount; creditors[creditor].amount -= amount;
    if (debtors[debtor].amount < 0.005) debtor += 1;
    if (creditors[creditor].amount < 0.005) creditor += 1;
  }
  return debts;
}

function Stat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) { return <div className="rounded-[22px] border border-white/8 bg-black/18 p-4"><div className="flex items-center gap-2 text-[#72d7dc]">{icon}<span className="text-[10px] uppercase tracking-[.14em] text-white/38">{label}</span></div><p className="mt-2 text-2xl font-medium text-white">{value}</p></div>; }
function Avatar({ name, index }: { name: string; index: number }) { return <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold text-[#071012] ${avatarColor(index)}`}>{initials(name)}</span>; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?"; }
function avatarColor(index: number) { return ["bg-[#72d7dc]", "bg-[#f1bf75]", "bg-[#a9d18e]", "bg-[#c7a7ee]", "bg-[#f19a8b]"][Math.max(0, index) % 5]; }
function money(value: number, currency: string) { try { return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } }
