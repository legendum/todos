import { useState } from "react";
import { usePuesFetch } from "../core/Pues";
import { getThemePref, setThemePref, type ThemePref } from "./state";

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export type ThemeChooserProps = {
  endpoint?: string;
  /** Override the `fetch` implementation for the persistence PATCH. Falls
   * back to the value supplied via `<Pues fetch={...}>`, then to the
   * global `fetch`. Most consumers wrap their app in `<Pues>` and leave
   * this unset. */
  fetch?: typeof fetch;
};

export function ThemeChooser({
  endpoint,
  fetch: fetchOverride,
}: ThemeChooserProps) {
  const fetchImpl = usePuesFetch(fetchOverride);
  const [pref, setPref] = useState<ThemePref>(() => getThemePref());

  function choose(next: ThemePref) {
    setPref(next);
    setThemePref(next);
    if (endpoint) {
      fetchImpl(endpoint, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta: { theme: next } }),
      }).catch(() => null);
    }
  }

  return (
    <fieldset className="pues-theme-chooser">
      <legend className="pues-sr-only">Color theme</legend>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="pues-theme-chooser-option"
          aria-pressed={pref === opt.value}
          onClick={() => choose(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </fieldset>
  );
}
