"use client";

import { useEffect, useState } from "react";
import { applyThemeMode, loadSettings, type ThemeMode } from "../../lib/userScope";

export default function ThemeClient() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const settings = loadSettings();
    setMode(settings.themeMode);
    applyThemeMode(settings.themeMode);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const current = loadSettings().themeMode;
      if (current === "system") {
        applyThemeMode("system");
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const label = mode === "system" ? "System" : mode === "dark" ? "Dark" : "Light";

  return (
    <button
      type="button"
      onClick={() => {
        const next: ThemeMode = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
        setMode(next);
        applyThemeMode(next);
      }}
      className="theme-toggle"
      title="Toggle theme mode"
      aria-label="Toggle theme mode"
    >
      <span aria-hidden="true">{mode === "dark" ? "*" : mode === "light" ? "o" : "~"}</span>
      <span>{label}</span>
    </button>
  );
}
