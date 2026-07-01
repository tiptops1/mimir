"use client";

import { useEffect } from "react";

// Registers the PWA service worker (public/sw.js). Production only — a SW in
// dev caches Turbopack chunks and makes hot reload lie to you.

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failing (unsupported / blocked) never blocks the app.
    });
  }, []);
  return null;
}
