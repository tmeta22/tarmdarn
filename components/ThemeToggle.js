import { useEffect, useState } from "react";
import Icon from "./Icon";

const STORAGE_KEY = "taamdan-theme";

// Light -> Dark -> System, so the OS preference is always one click away.
const ORDER = ["light", "dark", "system"];

const LABELS = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

const NEXT_HINT = {
  light: "Switch to dark",
  dark: "Follow system",
  system: "Switch to light",
};

function resolve(pref) {
  if (pref === "dark" || pref === "light") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(pref) {
  const resolved = resolve(pref);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePref = pref;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#0b0f17" : "#f7f8fa");
}

export default function ThemeToggle() {
  // Starts on "system" so the server and first client render match exactly.
  // The visible icon is chosen by CSS from `data-theme-pref`, which the
  // bootstrap script already set on <html> — so the right icon paints
  // immediately without a hydration mismatch.
  const [pref, setPref] = useState("system");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial = ORDER.includes(stored) ? stored : "system";
    setPref(initial);
    apply(initial);
  }, []);

  // Keep "system" honest when the OS flips while the page is open.
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
    setPref(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    apply(next);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      title={`Theme: ${LABELS[pref]} — ${NEXT_HINT[pref]}`}
      aria-label={`Theme: ${LABELS[pref]}. ${NEXT_HINT[pref]}.`}
    >
      {/* All three are rendered; CSS shows the one matching data-theme-pref. */}
      <span className="theme-icon theme-icon-light" aria-hidden="true">
        <Icon name="sun" />
      </span>
      <span className="theme-icon theme-icon-dark" aria-hidden="true">
        <Icon name="moon" />
      </span>
      <span className="theme-icon theme-icon-system" aria-hidden="true">
        <Icon name="monitor" />
      </span>
    </button>
  );
}
