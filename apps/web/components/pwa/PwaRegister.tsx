"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Best-effort registration; offline shell still works when cached.
      });
    }

    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {
        // Best-effort persistence request; offline shell remains usable.
      });
    }
  }, []);

  return null;
}
