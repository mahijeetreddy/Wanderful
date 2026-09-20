import { useEffect, useState } from "react";
import { Compass, Loader2, RefreshCw } from "lucide-react";
import { apiFetch, readApiJson } from "../../api/client";

type GuidebookContent = {
  overview: string;
  currency_code: string;
  currency_notes: string;
  language_basics: string[];
  local_customs: string[];
  safety_tips: string[];
  packing_notes: string[];
  transport_tips: string[];
};

type Guidebook = { id: number; trip_id: number; status: string; content: GuidebookContent; error: string };

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function GuidebookPanel({
  open,
  tripId,
  tripName,
  onClose,
}: {
  open: boolean;
  tripId: string | null;
  tripName?: string;
  onClose: () => void;
}) {
  const [guidebook, setGuidebook] = useState<Guidebook | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!tripId) return;
    setLoading(true);
    try {
      const response = await apiFetch(`/api/trips/${tripId}/guidebook`);
      if (response.status === 404) {
        setGuidebook(null);
        setError("");
        return;
      }
      const payload = await readApiJson<{ guidebook: Guidebook }>(response);
      setGuidebook(payload.guidebook);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load guidebook.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && tripId) void load();
  }, [open, tripId]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const generate = async () => {
    if (!tripId) return;
    setGenerating(true);
    setError("");
    try {
      const payload = await readApiJson<{ guidebook: Guidebook }>(
        await apiFetch(`/api/trips/${tripId}/guidebook`, { method: "POST" }),
      );
      setGuidebook(payload.guidebook);
      const maxPolls = 30;
      for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        await wait(attempt < 4 ? 1200 : 2000);
        const response = await apiFetch(`/api/trips/${tripId}/guidebook`);
        const polled = await readApiJson<{ guidebook: Guidebook }>(response);
        setGuidebook(polled.guidebook);
        if (polled.guidebook.status === "complete" || polled.guidebook.status === "failed") {
          break;
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate guidebook.");
    } finally {
      setGenerating(false);
    }
  };

  const isBusy = generating || guidebook?.status === "pending" || guidebook?.status === "generating";
  const content = guidebook?.content;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[#0e1518]/72 px-4 backdrop-blur-md" onClick={onClose}>
      <section
        className="max-h-[88vh] w-[min(94vw,760px)] overflow-auto rounded-[32px] border border-[#3fb6c4]/16 bg-[#0e1518]/92 p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Guidebook</p>
            <h2 className="mt-2 flex items-center gap-3 text-3xl font-medium text-white">
              <Compass size={26} /> {tripName || "Destination guide"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/8 px-3 py-2 text-sm text-white/72 hover:bg-[#3fb6c4]/14"
          >
            Close
          </button>
        </div>

        {error ? <p className="mt-4 rounded-2xl border border-red-200/16 bg-red-300/10 p-3 text-sm text-red-50">{error}</p> : null}
        {loading ? (
          <div className="mt-8 flex items-center justify-center gap-2 text-white/58">
            <Loader2 className="animate-spin" size={18} /> Loading
          </div>
        ) : null}

        {!loading && !guidebook ? (
          <div className="mt-8 rounded-2xl border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.04] p-6 text-center">
            <p className="text-sm text-white/58">
              Generate an AI destination guide - customs, safety, currency, and transport tips - for this trip.
            </p>
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#3fb6c4] px-4 py-2.5 text-sm font-medium text-[#06181a] transition hover:scale-[1.01] disabled:opacity-40"
            >
              {generating ? <Loader2 className="animate-spin" size={14} /> : null} Generate guidebook
            </button>
          </div>
        ) : null}

        {guidebook && isBusy ? (
          <div className="mt-8 flex items-center justify-center gap-2 text-white/58">
            <Loader2 className="animate-spin" size={18} /> Writing your guidebook...
          </div>
        ) : null}

        {guidebook && guidebook.status === "failed" && !generating ? (
          <div className="mt-8 rounded-2xl border border-red-200/16 bg-red-300/10 p-5 text-center">
            <p className="text-sm text-red-50">{guidebook.error || "Guidebook generation failed."}</p>
            <button
              type="button"
              onClick={generate}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#3fb6c4]/12 px-4 py-2.5 text-sm text-white/72 hover:bg-[#3fb6c4]/10"
            >
              <RefreshCw size={14} /> Try again
            </button>
          </div>
        ) : null}

        {guidebook && guidebook.status === "complete" && content ? (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm leading-relaxed text-white/78">{content.overview}</p>
              <button
                type="button"
                onClick={generate}
                disabled={generating}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-[#3fb6c4]/12 px-3 py-1.5 text-xs text-white/68 hover:bg-[#3fb6c4]/10"
              >
                <RefreshCw size={12} /> Regenerate
              </button>
            </div>
            <GuidebookSection title="Currency" items={[content.currency_notes].filter(Boolean)} prefix={content.currency_code} />
            <GuidebookSection title="Language basics" items={content.language_basics} />
            <GuidebookSection title="Local customs" items={content.local_customs} />
            <GuidebookSection title="Safety tips" items={content.safety_tips} />
            <GuidebookSection title="Packing notes" items={content.packing_notes} />
            <GuidebookSection title="Getting around" items={content.transport_tips} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function GuidebookSection({ title, items, prefix }: { title: string; items: string[]; prefix?: string }) {
  if (!items.length) return null;
  return (
    <article className="rounded-[22px] border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.055] p-4">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/45">
        {title}
        {prefix ? ` - ${prefix}` : ""}
      </p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, index) => (
          <li key={index} className="text-sm leading-relaxed text-white/72">
            {item}
          </li>
        ))}
      </ul>
    </article>
  );
}
