import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function initializeTheme() {
  try { document.documentElement.dataset.theme = localStorage.getItem("wanderful-theme") === "light" ? "light" : "dark"; }
  catch { document.documentElement.dataset.theme = "dark"; }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "dark");
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === "wanderful-theme") { initializeTheme(); setTheme(document.documentElement.dataset.theme!); } };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return <button type="button" className="theme-toggle" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={() => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next; setTheme(next);
    try { localStorage.setItem("wanderful-theme", next); } catch { /* Session-only preference when storage is blocked. */ }
  }}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>;
}
