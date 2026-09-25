import { useEffect, useState } from "react";
import { BookOpen, Loader2, Pencil, Trash2 } from "lucide-react";
import { apiFetch, readApiJson } from "../../api/client";
import { Modal } from "../search/Modal";

type JournalEntry = { id: number; trip_id: number; body: string; created_at: string; updated_at: string };

export function JournalPanel({
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
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState("");

  const refresh = async () => {
    if (!tripId) return;
    setLoading(true);
    try {
      const payload = await readApiJson<{ entries: JournalEntry[] }>(await apiFetch(`/api/trips/${tripId}/journal`));
      setEntries(payload.entries || []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load journal entries.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && tripId) void refresh();
  }, [open, tripId]);

  if (!open) return null;

  const addEntry = async () => {
    const body = draft.trim();
    if (!body || !tripId) return;
    setSaving(true);
    try {
      const payload = await readApiJson<{ entry: JournalEntry }>(
        await apiFetch(`/api/trips/${tripId}/journal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        }),
      );
      setEntries((current) => [payload.entry, ...current]);
      setDraft("");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save journal entry.");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (entryId: number) => {
    const body = editingBody.trim();
    if (!body || !tripId) return;
    try {
      const payload = await readApiJson<{ entry: JournalEntry }>(
        await apiFetch(`/api/trips/${tripId}/journal/${entryId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        }),
      );
      setEntries((current) => current.map((entry) => (entry.id === entryId ? payload.entry : entry)));
      setEditingId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update journal entry.");
    }
  };

  const removeEntry = async (entryId: number) => {
    if (!tripId) return;
    try {
      await readApiJson(await apiFetch(`/api/trips/${tripId}/journal/${entryId}`, { method: "DELETE" }));
      setEntries((current) => current.filter((entry) => entry.id !== entryId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete journal entry.");
    }
  };

  return (
    <Modal label="Travel journal" onClose={onClose}>
      <aside
        className="absolute right-0 top-0 h-full w-[min(94vw,460px)] overflow-auto border-l border-[#3fb6c4]/12 bg-[#0e1518]/88 p-5 shadow-[-28px_0_90px_rgba(0,0,0,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/48">Journal</p>
            <h3 className="mt-1 flex items-center gap-2 text-3xl font-medium tracking-[-0.04em] text-white">
              <BookOpen size={24} /> {tripName || "Trip notes"}
            </h3>
            <p className="mt-2 text-sm text-white/52">Personal notes, bookings, and reminders for this trip.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#3fb6c4]/12 bg-[#3fb6c4]/8 px-3 py-2 text-sm text-white/72 hover:bg-[#3fb6c4]/14"
          >
            Close
          </button>
        </div>

        <div className="rounded-[24px] border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.05] p-4">
          <textarea aria-label="New journal entry"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write a note - a booking confirmation, a reminder, a memory..."
            rows={3}
            className="w-full resize-none rounded-2xl border border-[#3fb6c4]/14 bg-[#0e1518]/60 p-3 text-sm text-white placeholder:text-white/32 focus:border-[#3fb6c4]/40 focus:outline-none"
          />
          <button
            type="button"
            onClick={addEntry}
            disabled={saving || !draft.trim()}
            className="mt-3 w-full rounded-full bg-[#3fb6c4] px-4 py-2.5 text-sm font-medium text-[#06181a] transition hover:scale-[1.01] disabled:opacity-40"
          >
            {saving ? "Saving..." : "Add entry"}
          </button>
        </div>

        {error ? <p className="mt-4 text-sm text-red-100">{error}</p> : null}
        {loading ? <Loader2 className="mx-auto mt-8 animate-spin text-white/60" /> : null}

        <div className="mt-5 space-y-3">
          {entries.map((entry, index) => (
            <article
              key={entry.id}
              style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
              className="card-hover card-enter rounded-[22px] border border-[#3fb6c4]/12 bg-[#3fb6c4]/[0.055] p-4"
            >
              {editingId === entry.id ? (
                <div>
                  <textarea aria-label="Edit journal entry"
                    value={editingBody}
                    onChange={(event) => setEditingBody(event.target.value)}
                    rows={3}
                    className="w-full resize-none rounded-2xl border border-[#3fb6c4]/14 bg-[#0e1518]/60 p-3 text-sm text-white focus:border-[#3fb6c4]/40 focus:outline-none"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveEdit(entry.id)}
                      className="rounded-full bg-[#3fb6c4] px-3 py-1.5 text-sm font-medium text-[#06181a]"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-full border border-[#3fb6c4]/12 px-3 py-1.5 text-sm text-white/68"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/80">{entry.body}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-white/38">{new Date(entry.created_at).toLocaleString()}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(entry.id);
                          setEditingBody(entry.body);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#3fb6c4]/12 px-3 py-1.5 text-xs text-white/68 hover:bg-[#3fb6c4]/10"
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeEntry(entry.id)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-red-200/14 px-3 py-1.5 text-xs text-red-50/70"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </div>
                </>
              )}
            </article>
          ))}
          {!loading && !entries.length ? (
            <p className="rounded-2xl border border-[#3fb6c4]/10 bg-[#3fb6c4]/[0.04] p-5 text-sm text-white/52">
              No entries yet. Add your first note above.
            </p>
          ) : null}
        </div>
      </aside>
    </Modal>
  );
}
