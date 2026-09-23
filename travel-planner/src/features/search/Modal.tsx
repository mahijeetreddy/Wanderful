import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Native top-layer dialog: escapes page stacking contexts and contains keyboard focus. */
export function Modal({ children, label, onClose }: { children: ReactNode; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return createPortal(<dialog ref={ref} aria-label={label}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto border-0 bg-[#0e1518]/80 p-4 text-white backdrop:backdrop-blur-md open:grid open:place-items-center">
    {children}
  </dialog>, document.body);
}
