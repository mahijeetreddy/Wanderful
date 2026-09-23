import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./features/auth/session";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SharedTripView } from "./features/share/SharedTripView";
import "./index.css";

const shareMatch = window.location.pathname.match(/^\/share\/([^/]+)$/);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>{shareMatch ? <SharedTripView token={shareMatch[1]} /> : <App />}</QueryClientProvider>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
