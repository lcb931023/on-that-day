import { API_BASE } from "./constants";

// The app runs two ways: against the Go server, and as flat files on GitHub
// Pages under a repo subpath. Both serve the same /data/*.json shape, so route
// everything through one root — API_BASE when a server is configured, else
// Vite's base path.
const ROOT = (API_BASE || import.meta.env.BASE_URL).replace(/\/$/, "");

export function dataUrl(path) {
  return `${ROOT}/data/${path}`;
}

export async function fetchAuthors() {
  const res = await fetch(dataUrl("authors.json"));
  if (!res.ok) throw new Error("Failed to fetch authors");
  return res.json();
}

export async function fetchDay(month, day) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const res = await fetch(dataUrl(`days/${mm}-${dd}.json`));
  if (!res.ok) throw new Error("Failed to fetch day");
  return res.json();
}

export async function fetchVoyage(key) {
  const res = await fetch(dataUrl(`voyages/${key}.json`));
  if (!res.ok) throw new Error("Failed to fetch voyage");
  return res.json();
}

export async function fetchOnThisDay(m, d) {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.events || [];
  } catch {
    return [];
  }
}
