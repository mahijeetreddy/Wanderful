import { useState } from "react";
import "./travel-loading.css";

export type LoadingTheme = "flights" | "stays" | "itinerary" | "map" | "documents" | "account" | "budget";
const labels: Record<LoadingTheme, string> = {
  flights: "Finding your next takeoff", stays: "Finding a place to land",
  itinerary: "Putting your adventure together", map: "Mapping your stops",
  documents: "Opening your travel notebook", account: "Getting things ready", budget: "Balancing your trip",
};

/** Real request state only. Decorative motion finishes in four seconds, never loops. */
export function TravelLoading({ theme = "itinerary", label, compact = false }: {
  theme?: LoadingTheme; label?: string; compact?: boolean;
}) {
  const [paused, setPaused] = useState(false);
  return <div className={`travel-loading${compact ? " travel-loading--compact" : ""}`} data-loading-theme={theme} data-paused={paused}>
    <svg className="travel-loading__scene" viewBox="0 0 240 120" fill="none" aria-hidden="true">
      <circle cx="185" cy="30" r="17" className="travel-loading__sun" />
      <path d="M16 96H224" className="travel-loading__ground" />
      <g className="travel-loading__clouds" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M25 32h29m-21-7h12M166 65h35m-26-7h13" />
      </g>
      {theme === "flights" ? <g className="travel-loading__hero travel-loading__plane">
        <path d="m64 70 40-7 29-33 12 1-14 30 42-5c18-2 26 4 22 10-2 3-9 6-20 7l-48 5-18 20-11 1 6-20-32 1-17-17 9-2z" fill="var(--loading-blue)" stroke="var(--loading-ink)" strokeWidth="2" strokeLinejoin="round" />
        <path d="m156 64 7-1m-22 3 6-1m-22 3 6-1" stroke="var(--loading-ink)" strokeWidth="3" strokeLinecap="round" />
        <path d="M30 81h24M20 88h26" stroke="var(--loading-gold)" strokeWidth="3" strokeLinecap="round" />
      </g> : theme === "stays" ? <g className="travel-loading__hero">
        <rect x="73" y="30" width="94" height="66" rx="9" fill="var(--loading-blue)" stroke="var(--loading-ink)" strokeWidth="2" />
        <path d="M68 32h104M111 96V77h18v19" stroke="var(--loading-ink)" strokeWidth="3" strokeLinejoin="round" />
        {[88, 116, 144].flatMap(x => [44, 61].map(y => <rect key={`${x}-${y}`} x={x} y={y} width="9" height="9" rx="2" className="travel-loading__window" />))}
        <path d="M53 96V76m-7 5 7-9 7 9M188 96V76m-7 5 7-9 7 9" stroke="var(--loading-gold)" strokeWidth="3" />
      </g> : theme === "documents" || theme === "account" ? <g className="travel-loading__hero">
        <path d="M81 29h76a7 7 0 0 1 7 7v59h-46l-42 3V36a7 7 0 0 1 5-7Z" fill="var(--loading-blue)" stroke="var(--loading-ink)" strokeWidth="2" />
        <path d="M119 31v64M87 48h21m-21 13h21m23-13h21m-21 13h21m-21 13h14" stroke="var(--loading-ink)" strokeWidth="3" strokeLinecap="round" />
        <path d="m143 29 11-9v23l-6-4-5 4z" fill="var(--loading-gold)" />
      </g> : theme === "budget" ? <g className="travel-loading__hero">
        {[0, 1, 2].map(i => <g key={i} transform={`translate(${i * 29} ${-i * 12})`}><rect x="78" y="72" width="27" height="23" rx="5" fill="var(--loading-blue)" stroke="var(--loading-ink)" strokeWidth="2" /><ellipse cx="91.5" cy="73" rx="13.5" ry="5" fill="var(--loading-gold)" /></g>)}
      </g> : <g className="travel-loading__hero">
        <path d="m63 86 32-7 34 9 42-8" stroke="var(--loading-blue)" strokeWidth="18" strokeLinecap="round" />
        <path d="M65 85c0-36 77 12 81-20" stroke="var(--loading-gold)" strokeWidth="3" strokeDasharray="4 7" strokeLinecap="round" />
        <path d="M145 25a19 19 0 0 0-19 19c0 15 19 30 19 30s19-15 19-30a19 19 0 0 0-19-19Z" fill="var(--loading-blue)" stroke="var(--loading-ink)" strokeWidth="2" />
        <circle cx="145" cy="44" r="6" fill="var(--loading-gold)" />
      </g>}
    </svg>
    <p role="status" className="travel-loading__label">{label || labels[theme]}</p>
    {!compact && <button type="button" className="travel-loading__pause" onClick={() => setPaused(value => !value)} aria-pressed={paused}>{paused ? "Resume animation" : "Pause animation"}</button>}
  </div>;
}
