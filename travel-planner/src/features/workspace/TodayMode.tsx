import { useEffect, useState } from "react";
import { ArrowUpRight, MapPin, Sun } from "lucide-react";
import type { StructuredDayData } from "../../domain/travel";
import { field, secondary, type InboxBooking } from "./types";

export function localDay(now: Date, zone: string) {
  if (!zone) return null;
  try { const parts = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now); const get = (type: string) => parts.find(p => p.type === type)?.value; return `${get("year")}-${get("month")}-${get("day")}`; } catch { return null; }
}
export function startMinutes(value?: string) {
  const match = /^(\d{1,2}):(\d{2})(?:\s*[-–—].*)?$/.exec(value?.trim() || "");
  if (!match || +match[1] > 23 || +match[2] > 59) return null;
  return +match[1] * 60 + +match[2];
}
export function TodayMode({ destination, days, bookings = [], timezone = "", currency = "", offline = false }: { destination: string; days: StructuredDayData[]; bookings?: InboxBooking[]; timezone?: string; currency?: string; offline?: boolean }) {
  const [zone, setZone] = useState(timezone), [chosen, setChosen] = useState(""), [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(timer); }, []);
  const today = localDay(now, zone);
  const date = chosen || (days.some(d => d.date === today) ? today! : days[0]?.date || "");
  const day = days.find(d => d.date === date);
  let minute: number | null = null;
  if (today) { const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now); minute = Number(parts.find(p => p.type === "hour")?.value) * 60 + Number(parts.find(p => p.type === "minute")?.value); }
  const timed = (day?.activities || []).map((a, i) => ({ a, i, minute: startMinutes(a.time) })).filter(a => a.minute !== null).sort((a, b) => a.minute! - b.minute!);
  const next = date === today && minute !== null ? timed.find(a => a.minute! >= minute!)?.i : undefined;
  const relevant = bookings.filter(b => b.status === "confirmed" && b.start_date && b.start_date <= date && (b.end_date || b.start_date) >= date);
  return <section aria-label="Today travel mode" className="space-y-6"><header className="rounded-3xl border border-[#e8cd95]/30 bg-gradient-to-br from-[#3b3527] via-[#183736] to-[#102127] p-6"><Sun className="text-[#e8cd95]" /><p className="mt-4 text-xs uppercase tracking-[.2em] text-[#e8cd95]">{date === today ? "Today in" : "Day preview ·"}</p><h3 className="mt-2 text-4xl">{destination}</h3><p className="mt-2 text-slate-200">{day?.title || "No itinerary for this day"}</p><p className="mt-3 text-sm text-slate-300">{offline ? "Offline copy · read-only" : "Your plan, one day at a time."}</p></header>
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Travel day<select className={field} value={date} onChange={e => setChosen(e.target.value)}>{days.map((d, i) => <option key={`${d.date}-${i}`} value={d.date}>Day {d.day_number} · {d.date}</option>)}</select></label><label className="text-sm">Destination time zone<input className={field} placeholder="Europe/Lisbon" value={zone} onChange={e => setZone(e.target.value)} /></label></div>
    {!today && <p role="status" className="text-sm text-amber-100">Choose a valid destination time zone to identify today and the next scheduled activity.</p>}
    {today && date !== today && <p className="text-sm text-slate-300">Previewing {date || "an undated day"}. Today in this time zone is {today}.</p>}
    {day?.estimated_cost != null && currency && <p className="text-sm text-slate-200">Planned daily estimate: {currency} {day.estimated_cost} · not recorded spending</p>}
    {!day?.activities?.length && <p className="rounded-2xl border border-dashed border-white/25 p-6 text-slate-300">Nothing scheduled. Leave room to explore.</p>}
    <ol className="space-y-3">{(day?.activities || []).map((activity, index) => <li key={index} className={`rounded-2xl border p-5 ${index === next ? "border-[#91e4db] bg-[#1a3b37]" : "border-white/15 bg-white/5"}`}>
      <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-[#91e4db]">{activity.time || activity.period || "Flexible"}</p>{index === next && <span className="rounded-full bg-[#91e4db] px-3 py-1 text-xs text-[#092322]">Next scheduled</span>}</div><h4 className="mt-2 text-xl">{activity.title}</h4><p className="mt-2 text-sm text-slate-300"><MapPin size={14} className="mr-1 inline" />{activity.location || "Location not recorded"}</p>{activity.schedule_conflict && <p className="mt-3 text-sm text-amber-100">{activity.schedule_conflict}</p>}
      {activity.location && !offline && <a className={`${secondary} mt-4 inline-flex items-center gap-2`} target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${activity.location}, ${destination}`)}`}>Directions <ArrowUpRight size={16} /></a>}
    </li>)}</ol>
    {relevant.length > 0 && <section><h4 className="text-xl">Bookings for this day</h4><div className="mt-3 grid gap-3 sm:grid-cols-2">{relevant.map((b, i) => <article key={i} className="rounded-2xl border border-[#e8cd95]/25 p-4"><p className="text-xs text-[#e8cd95]">{b.kind} · confirmed by you</p><p className="mt-2">{b.title}</p><p className="mt-2 font-mono text-sm">{b.reference || "No reference"} {b.time}</p><p className="mt-2 text-sm text-slate-300">{b.address}</p></article>)}</div></section>}
    <p className="text-sm text-slate-300">{offline ? "Booking inbox, documents and live directions are not included in this offline copy." : "Going offline? Prepare a copy in Trip tools → Budget, offline & recovery."}</p>
  </section>;
}
