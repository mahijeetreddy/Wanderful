import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SharedTripView } from "./features/share/SharedTripView";
import "./index.css";

const shareMatch = window.location.pathname.match(/^\/share\/([^/]+)$/);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {shareMatch ? <SharedTripView token={shareMatch[1]} /> : <App />}
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
