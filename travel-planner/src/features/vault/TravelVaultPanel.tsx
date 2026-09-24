import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { CalendarClock, Download, FileImage, FileKey2, FileText, FolderLock, LockKeyhole, Plus, ShieldCheck, Trash2, UploadCloud, X } from "lucide-react";

import { apiFetch, readApiJson } from "../../api/client";
import type { SavedTrip, TravelDocument } from "../../domain/travel";
import { Modal } from "../search/Modal";

const categories = ["Booking", "Identity", "Insurance", "Transport", "Other"];

export function TravelVaultPanel({ trip, onClose }: { trip: SavedTrip | null; onClose: () => void }) {
  const [documents, setDocuments] = useState<TravelDocument[]>([]);
  const [category, setCategory] = useState("Booking");
  const [expiresOn, setExpiresOn] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!trip) return;
    const controller = new AbortController();
    setBusy(true); setStatus("");
    void apiFetch(`/api/trips/${trip.id}/documents`, { signal: controller.signal })
      .then((response) => readApiJson<{ documents: TravelDocument[] }>(response))
      .then((payload) => setDocuments(payload.documents || []))
      .catch((error) => { if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Could not open the vault."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [trip?.id]);

  if (!trip) return null;

  const upload = async () => {
    if (!selectedFile) { setStatus("Choose a PDF or image first."); return; }
    const body = new FormData(); body.append("file", selectedFile); body.append("category", category); body.append("expires_on", expiresOn);
    setBusy(true); setStatus("");
    try {
      const payload = await apiFetch(`/api/trips/${trip.id}/documents`, { method: "POST", body }).then((response) => readApiJson<{ document: TravelDocument }>(response));
      setDocuments((current) => [payload.document, ...current]); setSelectedFile(null); setExpiresOn("");
      if (inputRef.current) inputRef.current.value = "";
      setStatus("Document secured in your trip vault.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not upload the document."); }
    finally { setBusy(false); }
  };

  const remove = async (document: TravelDocument) => {
    if (!window.confirm(`Delete ${document.name}? This cannot be restored through itinerary history.`)) return;
    setBusy(true); setStatus("");
    try {
      await apiFetch(`/api/trips/${trip.id}/documents/${document.id}`, { method: "DELETE" }).then((response) => readApiJson(response));
      setDocuments((current) => current.filter((item) => item.id !== document.id)); setStatus("Document removed from the vault.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not remove the document."); }
    finally { setBusy(false); }
  };

  const expiring = documents.filter((document) => expiryState(document.expires_on) !== "safe").length;

  return <Modal label="Travel document vault" onClose={onClose}>
    <div className="mx-auto w-full max-w-6xl overflow-hidden rounded-[34px] border border-[#f1bf75]/16 bg-[#0b1517] shadow-[0_45px_150px_rgba(0,0,0,.7)]">
      <header className="vault-hero relative overflow-hidden border-b border-white/8 px-5 py-7 sm:px-8 sm:py-9">
        <div className="relative z-10 flex flex-wrap items-start justify-between gap-5"><div><div className="flex items-center gap-2 text-[#f1bf75]"><LockKeyhole size={15}/><p className="text-[10px] font-semibold uppercase tracking-[.2em]">Travel document vault</p></div><h2 id={titleId} className="mt-3 text-3xl font-medium tracking-[-.045em] text-white sm:text-5xl">Everything important. One safe place.</h2><p className="mt-3 text-sm text-white/46">{trip.name}</p></div><button ref={closeRef} type="button" aria-label="Close travel document vault" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-black/20 text-white/65 hover:text-white"><X size={18}/></button></div>
        <div className="relative z-10 mt-7 flex flex-wrap gap-3"><VaultStat label="Documents" value={`${documents.length}`} icon={<FolderLock size={16}/>}/><VaultStat label="Needs attention" value={`${expiring}`} icon={<CalendarClock size={16}/>}/><VaultStat label="Privacy" value="Private" icon={<ShieldCheck size={16}/>}/></div>
      </header>

      <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[360px_1fr] lg:p-8">
        <section className="vault-upload-card rounded-[28px] p-5 sm:p-6">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#f1bf75]/12 text-[#f1bf75]"><UploadCloud size={22}/></div><h3 className="mt-5 text-2xl font-medium tracking-[-.03em] text-white">Add a document</h3><p className="mt-2 text-sm leading-5 text-white/42">PDF, JPG, PNG, or WebP. Up to 8 MB.</p>
          <button type="button" onClick={() => inputRef.current?.click()} className="mt-5 grid min-h-32 w-full place-items-center rounded-[22px] border border-dashed border-[#f1bf75]/25 bg-[#f1bf75]/[.035] p-4 text-center hover:bg-[#f1bf75]/[.065]"><div>{selectedFile ? <FileKey2 size={26} className="mx-auto text-[#f1bf75]"/> : <Plus size={26} className="mx-auto text-white/30"/>}<p className="mt-2 text-sm font-medium text-white/78">{selectedFile?.name || "Choose a file"}</p>{selectedFile ? <p className="mt-1 text-xs text-white/36">{formatBytes(selectedFile.size)}</p> : null}</div></button>
          <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event: ChangeEvent<HTMLInputElement>) => setSelectedFile(event.target.files?.[0] || null)} className="sr-only"/>
          <label className="mt-4 block text-[10px] font-medium uppercase tracking-[.14em] text-white/35">Category<select value={category} onChange={(event) => setCategory(event.target.value)} className="vault-input mt-2 normal-case tracking-normal">{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="mt-3 block text-[10px] font-medium uppercase tracking-[.14em] text-white/35">Expiry date <span className="normal-case tracking-normal text-white/22">optional</span><input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} className="vault-input mt-2 normal-case tracking-normal"/></label>
          <button type="button" disabled={busy || !selectedFile} onClick={() => void upload()} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#f1bf75] px-5 py-3 text-sm font-semibold text-[#201508] disabled:opacity-40">{busy ? <UploadCloud size={15} className="animate-pulse"/> : <LockKeyhole size={15}/>}Secure document</button>
        </section>

        <section className="rounded-[28px] border border-white/8 bg-black/14 p-5 sm:p-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="section-kicker">Your documents</p><h3 className="mt-1 text-2xl font-medium text-white">Ready when you need them.</h3></div><span className="rounded-full border border-white/8 px-3 py-1.5 text-xs text-white/38">Private trip storage</span></div>
          {documents.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2">{documents.map((document) => <DocumentCard key={document.id} document={document} tripId={trip.id} busy={busy} onDelete={() => void remove(document)}/>)}</div> : <div className="mt-5 grid min-h-[330px] place-items-center rounded-[24px] border border-dashed border-white/10 bg-white/[.02] text-center"><div><FolderLock size={38} className="mx-auto text-[#f1bf75]/40"/><p className="mt-3 font-medium text-white/72">Your vault is empty</p><p className="mt-1 max-w-xs text-sm text-white/35">Add bookings, insurance, tickets, or identity documents.</p></div></div>}
        </section>
      </div>
      {status ? <div role="status" className="border-t border-white/8 px-6 py-3 text-center text-sm text-[#f1cf96]">{status}</div> : null}
    </div>
  </Modal>;
}

function DocumentCard({ document, tripId, busy, onDelete }: { document: TravelDocument; tripId: string; busy: boolean; onDelete: () => void }) {
  const expiry = expiryState(document.expires_on);
  return <article className="document-card rounded-[24px] border border-white/8 bg-white/[.028] p-4"><div className="flex items-start justify-between gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#f1bf75]/10 text-[#f1bf75]">{document.mime_type === "application/pdf" ? <FileText size={19}/> : <FileImage size={19}/>}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[.1em] ${expiry === "expired" ? "bg-red-400/12 text-red-200" : expiry === "soon" ? "bg-amber-300/12 text-amber-100" : "bg-[#72d7dc]/10 text-[#8de3df]"}`}>{expiry === "safe" ? document.category : expiry === "soon" ? "Expiring soon" : "Expired"}</span></div><h4 className="mt-4 truncate font-medium text-white/88" title={document.name}>{document.name}</h4><div className="mt-2 flex items-center justify-between gap-3 text-xs text-white/35"><span>{formatBytes(document.size_bytes)}</span><span>{document.expires_on ? `Expires ${formatDate(document.expires_on)}` : "No expiry"}</span></div><div className="mt-4 flex gap-2"><a href={`/api/trips/${tripId}/documents/${document.id}/download`} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#f1bf75]/18 bg-[#f1bf75]/8 px-3 py-2 text-xs text-[#f1d198]"><Download size={13}/>Download</a><button type="button" aria-label={`Delete ${document.name}`} disabled={busy} onClick={onDelete} className="grid h-9 w-9 place-items-center rounded-full border border-white/8 text-white/28 hover:border-red-300/20 hover:text-red-200"><Trash2 size={13}/></button></div></article>;
}

function VaultStat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) { return <div className="min-w-36 rounded-[20px] border border-white/8 bg-black/18 px-4 py-3"><div className="flex items-center gap-2 text-[#f1bf75]">{icon}<span className="text-[10px] uppercase tracking-[.12em] text-white/35">{label}</span></div><p className="mt-1 text-lg font-medium text-white">{value}</p></div>; }
function expiryState(value?: string | null): "safe" | "soon" | "expired" { if (!value) return "safe"; const days = (new Date(`${value}T00:00:00`).getTime() - Date.now()) / 86400000; return days < 0 ? "expired" : days <= 45 ? "soon" : "safe"; }
function formatBytes(value: number) { return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1000))} KB`; }
function formatDate(value: string) { const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date); }
