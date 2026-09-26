import { useEffect, useState } from "react";

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

/** Keeps `data-os-dark` in sync with the OS setting, for the "system" preference. */
export function watchOsTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const sync = () => document.documentElement.toggleAttribute("data-os-dark", mq.matches);
  sync();
  mq.addEventListener("change", sync);
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);
  useEffect(() => {
    applyTheme(pref);
    try {
      if (pref === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  }, [pref]);
  return [pref, setPref] as const;
}
