import { API_BASE } from "./constants";

export async function fetchAuthors() {
  const res = await fetch(`${API_BASE}/api/authors`);
  if (!res.ok) throw new Error("Failed to fetch authors");
  return res.json();
}

export async function fetchDay(month, day) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const res = await fetch(`${API_BASE}/api/days/${mm}-${dd}`);
  if (!res.ok) throw new Error("Failed to fetch day");
  return res.json();
}

export async function fetchVoyage(key) {
  const res = await fetch(`${API_BASE}/api/voyage/${key}`);
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
