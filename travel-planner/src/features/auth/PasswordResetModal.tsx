import { FormEvent, useState } from "react";
import { apiFetch, readApiJson } from "../../api/client";

export function PasswordResetModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  if (!token) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await readApiJson(
        await apiFetch("/api/auth/password/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, new_password: password }),
        }),
      );
      setStatus("Password reset. You can now sign in.");
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : "Could not reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-black/76 px-4 backdrop-blur-md">
      <form onSubmit={submit} className="w-[min(94vw,440px)] rounded-[30px] border border-white/16 bg-black/94 p-6">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">Account Recovery</p>
        <h2 className="mt-2 text-3xl font-medium text-white">Choose a new password</h2>
        <label className="mt-5 block">
          <span className="mb-2 block text-[10px] uppercase tracking-[0.15em] text-white/48">New password</span>
          <input type="password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 w-full rounded-2xl border border-white/14 bg-black/60 px-3 text-white outline-none" />
        </label>
        <button type="submit" disabled={loading} className="mt-4 w-full rounded-full bg-white px-4 py-3 font-medium text-black disabled:opacity-60">{loading ? "Updating..." : "Reset password"}</button>
        {status ? <p className="mt-3 text-sm text-white/62">{status}</p> : null}
        <button type="button" onClick={onClose} className="mt-4 w-full text-sm text-white/48 hover:text-white">Close</button>
      </form>
    </div>
  );
}
