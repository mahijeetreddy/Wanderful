import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Modal } from "../search/Modal";

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parse = (value: string) => new Date(`${value}T12:00:00`);
const label = (date: Date) => date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export function DateRangePicker({ start, end, onChange }: { start: string; end: string; onChange: (start: string, end: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<[string, string]>([start, end]);
  const today = iso(new Date());
  const [month, setMonth] = useState(() => parse(start || today));
  const [focusDay, setFocusDay] = useState(start || today);
  const grid = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  useLayoutEffect(() => {
    if (pendingFocus.current) { grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDay}"]`)?.focus(); pendingFocus.current = false; }
  }, [focusDay, month]);
  const nights = draft[0] && draft[1] ? Math.round((Date.parse(draft[1]) - Date.parse(draft[0])) / 86400000) : 0;
  const select = (value: string) => setDraft(([from, to]) => !from || to || value < from ? [value, ""] : [from, value]);
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -date.getDay(), End: 6 - date.getDay() } as Record<string, number>)[event.key];
    if (delta === undefined && !["PageUp", "PageDown"].includes(event.key)) return;
    event.preventDefault();
    const next = new Date(date);
    if (delta !== undefined) next.setDate(next.getDate() + delta);
    else { const day = next.getDate(); next.setDate(1); next.setMonth(next.getMonth() + (event.key === "PageUp" ? -1 : 1)); next.setDate(Math.min(day, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate())); }
    if (iso(next) < today) return;
    pendingFocus.current = true;
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1)); setFocusDay(iso(next));
  }
  return <div className="date-range-field sm:col-span-2">
    <div className="date-range-heading"><span>TRAVEL DATES</span><button type="button" className="date-open" onClick={() => { setDraft([start, end]); setMonth(parse(start || today)); setFocusDay(start || today); setOpen(true); }}><CalendarDays size={16} /> Choose dates</button></div>
    <div className="date-inputs"><label>Start date<input aria-label="Start date" type="date" required min={today} value={start} onChange={event => onChange(event.target.value, end < event.target.value ? "" : end)} /></label><span aria-hidden="true">→</span><label>End date<input aria-label="End date" type="date" required min={start || today} value={end} onChange={event => onChange(start, event.target.value)} /></label></div>
    {open && <Modal label="Choose travel dates" onClose={() => setOpen(false)}><section className="calendar-panel" onClick={event => event.stopPropagation()}>
      <header className="calendar-header"><div><p className="calendar-eyebrow">A LITTLE TIME AWAY</p><h2>When are we going?</h2></div><button type="button" className="calendar-icon" aria-label="Close calendar" onClick={() => setOpen(false)}><X size={20} /></button></header>
      <div className="calendar-selection" aria-live="polite"><div><span>DEPARTURE</span><strong>{draft[0] ? parse(draft[0]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Pick a date"}</strong></div><span aria-hidden="true">→</span><div><span>RETURN</span><strong>{draft[1] ? parse(draft[1]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Pick a date"}</strong></div></div>
      <div className="calendar-navigation"><button type="button" className="calendar-icon" aria-label="Previous month" disabled={month.getFullYear() === new Date().getFullYear() && month.getMonth() <= new Date().getMonth()} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={19} /></button><p aria-live="polite">{!draft[0] || draft[1] ? "Choose your departure" : "Now choose your return"}</p><button type="button" className="calendar-icon" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={19} /></button></div>
      <div className="calendar-months" ref={grid}>{[0, 1].map(offset => {
        const first = new Date(month.getFullYear(), month.getMonth() + offset, 1);
        const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        return <section key={offset} className={offset ? "calendar-second" : ""} aria-label={first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}><h3>{first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</h3><div className="calendar-grid"><>{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => <span className="calendar-weekday" key={day}>{day}</span>)}{Array.from({ length: first.getDay() }, (_, i) => <span key={`blank-${i}`} />)}{Array.from({ length: count }, (_, i) => {
          const date = new Date(first.getFullYear(), first.getMonth(), i + 1), value = iso(date), selected = value === draft[0] || value === draft[1];
          return <button type="button" key={value} data-date={value} aria-label={label(date)} aria-pressed={selected} aria-current={value === today ? "date" : undefined} disabled={value < today} tabIndex={value === focusDay || (i === 0 && !focusDay.startsWith(value.slice(0, 7))) ? 0 : -1} className={`calendar-day ${selected ? "is-selected" : draft[0] && draft[1] && value > draft[0] && value < draft[1] ? "in-range" : ""}`} onKeyDown={event => keyboard(event, date)} onClick={() => { setFocusDay(value); select(value); }}>{i + 1}</button>;
        })}</></div></section>;
      })}</div>
      <footer className="calendar-footer"><span>{nights > 0 ? `${nights} night${nights === 1 ? "" : "s"} · ${nights + 1} days` : "Select a date range"}</span><button type="button" className="calendar-apply" disabled={!draft[0] || !draft[1] || nights < 1} onClick={() => { onChange(...draft); setOpen(false); }}>Apply dates</button></footer>
    </section></Modal>}
  </div>;
}
