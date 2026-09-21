import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Footprints, Loader2, MapPinned, Navigation, Route } from "lucide-react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";

import { apiFetch, readApiJson } from "../../api/client";
import type { Coordinates, StructuredActivityData, StructuredDayData } from "../../domain/travel";

type RouteStop = { index: number; title: string; location: string; coordinates: Coordinates };

export function RouteMapPanel({ destination, days, mapCenter }: { destination: string; days: StructuredDayData[]; mapCenter: Coordinates | null }) {
  const [dayNumber, setDayNumber] = useState(days[0]?.day_number || 1);
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [unresolved, setUnresolved] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const cache = useRef(new Map<number, { stops: RouteStop[]; unresolved: number }>());
  const day = days.find((item) => item.day_number === dayNumber) || days[0];
  const activities = useMemo(() => (day?.activities || []).slice(0, 8), [day]);

  useEffect(() => {
    if (!day || !activities.length) {
      setStops([]);
      return;
    }
    const cached = cache.current.get(day.day_number);
    if (cached) {
      setStops(cached.stops);
      setUnresolved(cached.unresolved);
      return;
    }
    const embedded = activities.flatMap((activity, index) => activity.coordinates ? [{
      index,
      title: activity.title,
      location: activity.location || activity.title,
      coordinates: activity.coordinates,
    }] : []);
    if (embedded.length === activities.length) {
      cache.current.set(day.day_number, { stops: embedded, unresolved: 0 });
      setStops(embedded);
      setUnresolved(0);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setMessage("");
    void apiFetch("/api/route-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination, stops: activities.map((activity) => ({ title: activity.title, location: activity.location || activity.title })) }),
      signal: controller.signal,
    })
      .then((response) => readApiJson<{ stops: RouteStop[]; unresolved: number }>(response))
      .then((payload) => {
        const result = { stops: payload.stops || [], unresolved: payload.unresolved || 0 };
        cache.current.set(day.day_number, result);
        setStops(result.stops);
        setUnresolved(result.unresolved);
        if (!result.stops.length) setMessage("Map coordinates are unavailable. Open the route in Maps instead.");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not map this day.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [activities, day, destination]);

  if (!days.length) return null;
  const positions = stops.map((stop) => [stop.coordinates.lat, stop.coordinates.lng] as [number, number]);
  const center = positions[0] || (mapCenter ? [mapCenter.lat, mapCenter.lng] as [number, number] : [38.7223, -9.1393] as [number, number]);
  const mapsUrl = buildMapsUrl(destination, activities);

  return (
    <section className="route-map-shell overflow-hidden rounded-[30px] border border-[#3fb6c4]/12 bg-[#0b1719]/92">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 px-5 py-5 sm:px-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[#72d7dc]">Route map</p>
          <h4 className="mt-1 text-2xl font-medium tracking-[-.035em] text-white">See the day before you go.</h4>
        </div>
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-[#72d7dc]/20 bg-[#72d7dc]/10 px-4 py-2.5 text-sm text-white/80 hover:bg-[#72d7dc]/16">
          Open route <ExternalLink size={14} />
        </a>
      </div>

      <div className="flex gap-2 overflow-x-auto px-5 py-4 sm:px-6">
        {days.map((item) => (
          <button key={item.day_number} type="button" onClick={() => setDayNumber(item.day_number)} className={`shrink-0 rounded-full px-4 py-2 text-sm transition ${item.day_number === day?.day_number ? "bg-[#72d7dc] font-medium text-[#06181a]" : "border border-white/10 text-white/58 hover:text-white"}`}>
            Day {item.day_number}
          </button>
        ))}
      </div>

      <div className="grid min-h-[470px] lg:grid-cols-[370px_1fr]">
        <div className="border-b border-white/8 p-5 lg:border-b-0 lg:border-r sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-sm text-white/42">Day {day?.day_number}</p><h5 className="mt-1 text-xl font-medium text-white">{day?.title}</h5></div>
            <span className="rounded-full bg-white/[.05] px-3 py-1 text-xs text-white/50">{activities.length} stops</span>
          </div>
          <div className="mt-5 space-y-1">
            {activities.map((activity, index) => <RouteStopRow key={`${activity.title}-${index}`} activity={activity} index={index} last={index === activities.length - 1} />)}
          </div>
          {day?.transit_note ? <div className="mt-5 flex gap-3 rounded-2xl border border-[#72d7dc]/10 bg-[#72d7dc]/[.055] p-4"><Navigation size={16} className="mt-0.5 shrink-0 text-[#72d7dc]"/><p className="text-sm leading-5 text-white/62">{day.transit_note}</p></div> : null}
        </div>

        <div className="relative min-h-[420px] bg-[#081012]">
          {loading ? <div className="absolute inset-0 z-[500] grid place-items-center bg-[#081012]/70 backdrop-blur-sm"><div className="flex items-center gap-2 rounded-full bg-[#0e1e20] px-4 py-2 text-sm text-white/72"><Loader2 size={15} className="animate-spin"/>Mapping stops</div></div> : null}
          {stops.length ? (
            <MapContainer center={center} zoom={13} scrollWheelZoom className="h-full min-h-[420px] w-full">
              <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Polyline positions={positions} pathOptions={{ color: "#72d7dc", weight: 4, opacity: 0.82, dashArray: "8 8" }} />
              {stops.map((stop, index) => (
                <Marker key={`${stop.title}-${index}`} position={[stop.coordinates.lat, stop.coordinates.lng]} icon={numberedMarker(index + 1)}>
                  <Popup><strong>{stop.title}</strong><br />{stop.location}</Popup>
                </Marker>
              ))}
              <FitRoute positions={positions} />
            </MapContainer>
          ) : <div className="grid h-full min-h-[420px] place-items-center p-8 text-center"><div><MapPinned size={34} className="mx-auto text-[#72d7dc]/45"/><p className="mt-3 text-white/72">{message || "Preparing the route map."}</p><a href={mapsUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#72d7dc] px-4 py-2 text-sm font-medium text-[#06181a]">Open in Maps <ExternalLink size={13}/></a></div></div>}
          {unresolved ? <div className="absolute bottom-4 right-4 z-[500] rounded-full bg-[#071012]/88 px-3 py-1.5 text-xs text-white/62 backdrop-blur">{unresolved} stop{unresolved === 1 ? "" : "s"} shown in the list only</div> : null}
        </div>
      </div>
    </section>
  );
}

function RouteStopRow({ activity, index, last }: { activity: StructuredActivityData; index: number; last: boolean }) {
  return <div className="grid grid-cols-[34px_1fr] gap-3"><div className="flex flex-col items-center"><span className="grid h-8 w-8 place-items-center rounded-full border border-[#72d7dc]/28 bg-[#72d7dc]/12 text-xs font-semibold text-[#8de8eb]">{index + 1}</span>{!last ? <span className="my-1 h-full min-h-5 w-px bg-gradient-to-b from-[#72d7dc]/35 to-white/5"/> : null}</div><div className="pb-4"><div className="flex items-center gap-2 text-xs text-white/38"><span>{activity.time || activity.period || "Flexible"}</span>{index ? <><Footprints size={11}/><span>next stop</span></> : null}</div><p className="mt-1 font-medium text-white/88">{activity.title}</p><p className="mt-1 text-sm text-white/45">{activity.location || "Location pending"}</p></div></div>;
}

function FitRoute({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1) map.fitBounds(positions, { padding: [42, 42], maxZoom: 15 });
    else if (positions[0]) map.setView(positions[0], 14);
  }, [map, positions]);
  return null;
}

function numberedMarker(number: number) {
  return L.divIcon({ className: "route-number-marker", html: `<span>${number}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] });
}

function buildMapsUrl(destination: string, activities: StructuredActivityData[]) {
  const locations = activities.map((activity) => `${activity.location || activity.title}, ${destination}`).filter(Boolean);
  if (!locations.length) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;
  const origin = locations[0];
  const destinationStop = locations[locations.length - 1];
  const waypoints = locations.slice(1, -1).join("|");
  return `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destinationStop)}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ""}`;
}
