import { useSyncExternalStore } from "react";

export type ThemePref = "light" | "dark" | "system";
const KEY = "ss:theme";

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Applies the viewer's choice as `data-theme` on <html>; "system" follows the OS (see index.html). */
export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = pref;
}

const osDark = window.matchMedia("(prefers-color-scheme: dark)");

/** Keeps `data-os-dark` in sync with the OS setting, for the "system" preference. */
export function watchOsTheme() {
  const sync = () => {
    document.documentElement.toggleAttribute("data-os-dark", osDark.matches);
    emit();
  };
  sync();
  osDark.addEventListener("change", sync);
}

// One shared store, so the header toggle and the menu switch always agree.
let current: ThemePref = readPref();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function setTheme(pref: ThemePref) {
  current = pref;
  applyTheme(pref);
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
  emit();
}

export function useTheme() {
  const pref = useSyncExternalStore(subscribe, () => current);
  return [pref, setTheme] as const;
}

/** What's actually on screen right now: the explicit choice, or the OS setting for "system". */
export function useResolvedTheme(): "light" | "dark" {
  const pref = useSyncExternalStore(subscribe, () => current);
  const dark = useSyncExternalStore(subscribe, () => osDark.matches);
  return pref === "system" ? (dark ? "dark" : "light") : pref;
}
