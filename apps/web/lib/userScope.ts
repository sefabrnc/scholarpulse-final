export type UserProfile = {
  displayName: string;
  email: string;
  affiliation: string;
  role: string;
};

export type ThemeMode = "system" | "light" | "dark";

export type UserSettings = {
  digestEnabled: boolean;
  themeMode: ThemeMode;
  compactCards: boolean;
};

const PROFILE_KEY = "scholarpulse.web.profile";
const SETTINGS_KEY = "scholarpulse.web.settings";

const DEFAULT_PROFILE: UserProfile = {
  displayName: "Researcher",
  email: "researcher@example.com",
  affiliation: "Independent",
  role: "Reader"
};

const DEFAULT_SETTINGS: UserSettings = {
  digestEnabled: true,
  themeMode: "system",
  compactCards: false
};

function safeParse<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function applyThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") {
    return;
  }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = mode === "system" ? (prefersDark ? "dark" : "light") : mode;
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(resolved);
  document.documentElement.setAttribute("data-theme", resolved);
}

export function loadProfile(): UserProfile {
  if (typeof window === "undefined") {
    return DEFAULT_PROFILE;
  }
  const stored = safeParse<UserProfile>(window.localStorage.getItem(PROFILE_KEY));
  return stored ?? DEFAULT_PROFILE;
}

export function saveProfile(profile: UserProfile) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function loadSettings(): UserSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }
  const stored = safeParse<Partial<UserSettings> & { darkMode?: boolean }>(
    window.localStorage.getItem(SETTINGS_KEY)
  );
  if (!stored) {
    return DEFAULT_SETTINGS;
  }
  const themeMode =
    stored.themeMode ??
    (typeof stored.darkMode === "boolean" ? (stored.darkMode ? "dark" : "light") : DEFAULT_SETTINGS.themeMode);
  return {
    digestEnabled: stored.digestEnabled ?? DEFAULT_SETTINGS.digestEnabled,
    themeMode,
    compactCards: stored.compactCards ?? DEFAULT_SETTINGS.compactCards
  };
}

export function saveSettings(settings: UserSettings) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  applyThemeMode(settings.themeMode);
}
