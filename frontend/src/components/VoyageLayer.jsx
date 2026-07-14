import { useEffect, useMemo, useRef } from "react";
import { Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import { VOYAGE_COLOR, SHIP_ICON } from "../constants";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const MERCATOR_LAT_LIMIT = 85.0511;

function createShipIcon() {
  return L.divIcon({
    className: "ship-leaflet-marker",
    html: `<div class="ship-marker">${SHIP_ICON}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function isValidPoint(e) {
  return (
    e != null &&
    typeof e.lat === "number" &&
    typeof e.lng === "number" &&
    !isNaN(e.lat) &&
    !isNaN(e.lng) &&
    !(e.lat === 0 && e.lng === 0)
  );
}

function unwrapLngNear(lng, reference) {
  let out = lng;
  while (out - reference > 180) out -= 360;
  while (reference - out > 180) out += 360;
  return out;
}

function normalizeLng(lng) {
  let out = lng;
  while (out <= -180) out += 360;
  while (out > 180) out -= 360;
  return out;
}

// Compute a sequence of points along the great circle between a and b.
// We also adjust longitudes so the short path across the antimeridian is chosen.
function greatCirclePoints(a, b, segments = 40) {
  let lngA = a.lng;
  let lngB = b.lng;
  if (lngB - lngA > 180) lngB -= 360;
  if (lngA - lngB > 180) lngA -= 360;

  const lat1 = a.lat * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;
  const dLng = (lngB - lngA) * DEG2RAD;

  const aSin = Math.sin;
  const aCos = Math.cos;
  const aAtan2 = Math.atan2;
  const aSqrt = Math.sqrt;

  const A = aCos(lat2) * aCos(dLng);
  const B = aCos(lat2) * aSin(dLng);
  const central = aAtan2(aSqrt((aCos(lat1) * B) ** 2 + (aCos(lat1) * A - aSin(lat1) * aCos(lat2)) ** 2), aSin(lat1) * aSin(lat2) + aCos(lat1) * A);

  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const A_t = aSin((1 - t) * central) / aSin(central);
    const B_t = aSin(t * central) / aSin(central);
    const x = A_t * aCos(lat1) * aCos(0) + B_t * aCos(lat2) * aCos(dLng);
    const y = A_t * aCos(lat1) * aSin(0) + B_t * aCos(lat2) * aSin(dLng);
    const z = A_t * aSin(lat1) + B_t * aSin(lat2);
    const lat = aAtan2(z, aSqrt(x * x + y * y)) * RAD2DEG;
    const lng = lngA + aAtan2(y, x) * RAD2DEG;
    points.push([lat, lng]);
  }
  return points;
}

function interpolateGreatCircle(a, b, t) {
  const lngB = unwrapLngNear(b.lng, a.lng);
  const lat1 = a.lat * DEG2RAD;
  const lng1 = a.lng * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;
  const lng2 = lngB * DEG2RAD;

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinLat2 = Math.sin(lat2);
  const cosLat2 = Math.cos(lat2);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 +
    cosLat1 * cosLat2 * Math.sin((lng2 - lng1) / 2) ** 2
  ));

  if (!Number.isFinite(d) || d < 1e-9) {
    return [a.lat + (b.lat - a.lat) * t, a.lng + (lngB - a.lng) * t];
  }

  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * cosLat1 * Math.cos(lng1) + B * cosLat2 * Math.cos(lng2);
  const y = A * cosLat1 * Math.sin(lng1) + B * cosLat2 * Math.sin(lng2);
  const z = A * sinLat1 + B * sinLat2;
  const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD2DEG;
  const wrappedLng = Math.atan2(y, x) * RAD2DEG;
  return [lat, unwrapLngNear(wrappedLng, a.lng + (lngB - a.lng) * t)];
}

function unwrapEntries(entries) {
  const valid = entries.filter(isValidPoint);
  if (!valid.length) return [];

  const out = [{ ...valid[0] }];
  for (let i = 1; i < valid.length; i++) {
    out.push({
      ...valid[i],
      lng: unwrapLngNear(valid[i].lng, out[out.length - 1].lng),
    });
  }
  return out;
}

function buildRoute(entries) {
  if (entries.length < 2) return [];

  const route = [];
  for (let i = 0; i < entries.length - 1; i++) {
    const a = entries[i];
    const b = entries[i + 1];
    const segment = greatCirclePoints(a, b, 40);
    if (i === 0) {
      route.push(...segment);
    } else {
      route.push(...segment.slice(1));
    }
  }
  return route;
}

function dateOrdinal(y, m, d, h = 0, min = 0) {
  return new Date(y, m - 1, d, h, min).getTime();
}

function clampCenterToVerticalWorld(map, latlng) {
  const zoom = map.getZoom();
  const size = map.getSize();
  const centerPoint = map.project(latlng, zoom);
  const northY = map.project([MERCATOR_LAT_LIMIT, 0], zoom).y;
  const southY = map.project([-MERCATOR_LAT_LIMIT, 0], zoom).y;
  const minY = northY + size.y / 2;
  const maxY = southY - size.y / 2;

  if (minY <= maxY) {
    centerPoint.y = Math.min(maxY, Math.max(minY, centerPoint.y));
  } else {
    centerPoint.y = (northY + southY) / 2;
  }

  return map.unproject(centerPoint, zoom);
}

function interpolatePosition(entries, currentDate) {
  if (!entries.length) return null;

  const target = dateOrdinal(
    currentDate.y,
    currentDate.m,
    currentDate.d,
    currentDate.h || 0,
    currentDate.min || 0
  );
  const firstOrd = dateOrdinal(entries[0].y, entries[0].m, entries[0].d);
  const lastOrd = dateOrdinal(
    entries[entries.length - 1].y,
    entries[entries.length - 1].m,
    entries[entries.length - 1].d
  );

  if (target <= firstOrd) {
    return { entry: entries[0], lat: entries[0].lat, lng: entries[0].lng, idx: 0 };
  }
  if (target >= lastOrd) {
    const last = entries[entries.length - 1];
    return { entry: last, lat: last.lat, lng: last.lng, idx: entries.length - 1 };
  }

  for (let i = 0; i < entries.length - 1; i++) {
    const a = entries[i];
    const b = entries[i + 1];
    const aOrd = dateOrdinal(a.y, a.m, a.d);
    const bOrd = dateOrdinal(b.y, b.m, b.d);
    if (target >= aOrd && target <= bOrd) {
      const span = bOrd - aOrd || 1;
      const t = (target - aOrd) / span;
      const p = interpolateGreatCircle(a, b, t);
      return {
        entry: t < 0.5 ? a : b,
        lat: p[0],
        lng: p[1],
        idx: i,
      };
    }
  }
  return null;
}

export default function VoyageLayer({ voyages, currentDate, focusShip, onOpenVoyageEntry }) {
  const map = useMap();
  const fittedRouteKeyRef = useRef(null);

  const unwrappedVoyages = useMemo(() => {
    return voyages.map((v) => ({
      ...v,
      entries: unwrapEntries(v.entries),
    }));
  }, [voyages]);

  const routes = useMemo(() => {
    return unwrappedVoyages.map((v) => ({
      key: v.key,
      positions: buildRoute(v.entries),
    }));
  }, [unwrappedVoyages]);

  const markers = useMemo(() => {
    const out = [];
    for (const v of unwrappedVoyages) {
      const pos = interpolatePosition(v.entries, currentDate);
      if (!pos) continue;
      out.push({
        key: v.key,
        pos: [pos.lat, pos.lng],
        entry: pos.entry,
        idx: pos.idx,
      });
    }
    return out;
  }, [unwrappedVoyages, currentDate]);

  useEffect(() => {
    if (!focusShip || !markers.length || !map) return;
    const center = clampCenterToVerticalWorld(map, L.latLng(markers[0].pos));
    map.panTo(center, { animate: false });
  }, [focusShip, markers, map]);

  const routeKey = useMemo(() => {
    return voyages.map((v) => `${v.key}:${v.entries.length}`).join("|");
  }, [voyages]);

  // Fit map when a voyage route first appears. After that, preserve user zoom
  // and pan while playback moves the ship marker.
  useEffect(() => {
    if (fittedRouteKeyRef.current === routeKey) return;
    const allPoints = routes.flatMap((r) => r.positions.map(([lat, lng]) => [lat, normalizeLng(lng)]));
    if (allPoints.length && map) {
      fittedRouteKeyRef.current = routeKey;
      map.flyToBounds(L.latLngBounds(allPoints).pad(0.1));
    }
  }, [routes, routeKey, map]);

  return (
    <>
      {routes.map((r) =>
        r.positions.length ? (
          <Polyline
            key={`route-${r.key}`}
            positions={r.positions}
            pathOptions={{ color: VOYAGE_COLOR, weight: 2.5, opacity: 0.8, dashArray: "6 8" }}
          />
        ) : null
      )}
      {markers.map((m) => (
        <Marker
          key={`ship-${m.key}`}
          position={m.pos}
          icon={createShipIcon()}
          eventHandlers={{
            click: () => onOpenVoyageEntry(m.key, m.entry, m.idx),
          }}
        />
      ))}
    </>
  );
}
