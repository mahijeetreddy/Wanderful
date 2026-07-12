import { useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck, X } from "lucide-react";
import { apiFetch, readApiJson } from "../../api/client";

type PendingUser = { id: number; name: string; email: string; status: string };

export function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const response = await apiFetch("/api/admin/users");
      const payload = await readApiJson<{ users: PendingUser[] }>(response);
      setUsers(payload.users || []);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load pending users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);
  if (!open) return null;

  const decide = async (userId: number, action: "approve" | "reject") => {
    try {
      await readApiJson(await apiFetch(`/api/admin/users/${userId}/${action}`, { method: "POST" }));
      setUsers((current) => current.filter((user) => user.id !== userId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update account.");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/72 px-4 backdrop-blur-md" onClick={onClose}>
      <section className="max-h-[88vh] w-[min(94vw,760px)] overflow-auto rounded-[32px] border border-white/16 bg-black/92 p-6" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Access Control</p><h2 className="mt-2 flex items-center gap-3 text-3xl font-medium text-white"><ShieldCheck size={26} /> Pending accounts</h2></div>
          <button type="button" onClick={onClose} className="rounded-full border border-white/12 px-3 py-2 text-sm text-white/68">Close</button>
        </div>
        {error ? <p className="mt-4 rounded-2xl border border-red-200/16 bg-red-300/10 p-3 text-sm text-red-50">{error}</p> : null}
        {loading ? <div className="mt-8 flex items-center justify-center gap-2 text-white/58"><Loader2 className="animate-spin" size={18} /> Loading</div> : null}
        {!loading && !users.length ? <p className="mt-8 rounded-2xl border border-white/10 bg-white/[0.05] p-5 text-sm text-white/58">No accounts are awaiting approval.</p> : null}
        <div className="mt-5 space-y-3">
          {users.map((user) => (
            <article key={user.id} className="rounded-[22px] border border-white/10 bg-white/[0.055] p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div><p className="font-medium text-white">{user.name}</p><p className="mt-1 text-sm text-white/52">{user.email}</p></div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => decide(user.id, "approve")} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-sm font-medium text-black"><Check size={14} /> Approve</button>
                  <button type="button" onClick={() => decide(user.id, "reject")} className="inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-2 text-sm text-white/68"><X size={14} /> Reject</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
