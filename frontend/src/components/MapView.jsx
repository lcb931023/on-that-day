import { useEffect, forwardRef, useImperativeHandle, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { COLORS, INITIALS, VOYAGE_COLOR, SHIP_ICON } from "../constants";
import { fmtDate, ageOn, yearsAgo, esc } from "../utils";
import VoyageLayer from "./VoyageLayer";

const BASE_TILE_SIZE = 256;

function minZoomForMapWidth(width) {
  if (!width) return 2;
  return Math.max(2, Math.ceil(Math.log2(width / BASE_TILE_SIZE)));
}

function createSealIcon(authorKey, count) {
  const html = `
    <div class="seal" style="--c:${COLORS[authorKey] || VOYAGE_COLOR}">
      ${INITIALS[authorKey] || SHIP_ICON}${count > 1 ? `<span class="seal-count">${count}</span>` : ""}
    </div>
  `;
  return L.divIcon({
    className: "",
    html,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function createYouIcon() {
  return L.divIcon({
    className: "",
    html: `<div class="you-dot"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function MapController({ groups, onSetMap, userLocation }) {
  const map = useMap();

  useEffect(() => {
    const zoom = L.control.zoom({ position: "bottomright" }).addTo(map);
    return () => zoom.remove();
  }, [map]);

  useEffect(() => {
    onSetMap(map);
  }, [map, onSetMap]);

  useEffect(() => {
    function updateMinZoom() {
      const minZoom = minZoomForMapWidth(map.getSize().x);
      map.setMinZoom(minZoom);
      if (map.getZoom() < minZoom) {
        map.setZoom(minZoom, { animate: false });
      }
    }

    updateMinZoom();
    map.on("resize", updateMinZoom);
    return () => map.off("resize", updateMinZoom);
  }, [map]);

  useEffect(() => {
    if (userLocation) {
      L.marker([userLocation.lat, userLocation.lng], { icon: createYouIcon(), zIndexOffset: 500 })
        .addTo(map)
        .bindPopup("You, today");
    }
  }, [userLocation, map]);

  return null;
}

function EntryMarkers({ groups, authors, onOpenPanel }) {
  return (
    <>
      {groups.map((group, gi) => {
        const { a, lat, lng, place } = group[0];
        const author = authors[a];
        if (!author) return null;
        return (
          <Marker
            key={`${a}-${lat}-${lng}-${gi}`}
            position={[lat, lng]}
            icon={createSealIcon(a, group.length)}
          >
            <Popup maxWidth={300} autoPanPaddingTopLeft={[24, 96]}>
              <div style={{ "--c": COLORS[a] || VOYAGE_COLOR }}>
                <div className="pp-author">{author.name}</div>
                <div className="pp-place">{place}</div>
                {group.map((e, ei) => {
                  const approx = e.delta ? `<span class="pp-approx">nearest entry — </span>` : "";
                  const snip = esc(e.text.replace(/\s+/g, " ").slice(0, 150)) + "…";
                  return (
                    <div
                      key={ei}
                      className="pp-entry"
                      onClick={() => onOpenPanel(gi, ei)}
                    >
                      <div className="pp-when">
                        <span dangerouslySetInnerHTML={{ __html: approx + fmtDate(e.y, e.m, e.d) }} />
                        <span className="age">
                          {" "}· aged {ageOn(author.born, e.y, e.m, e.d)} · {yearsAgo(e.y)} years ago
                        </span>
                      </div>
                      <div className="pp-snip" dangerouslySetInnerHTML={{ __html: snip }}></div>
                      <div className="pp-open">Read the entry →</div>
                    </div>
                  );
                })}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

const MapView = forwardRef(function MapView(
  { mode, groups, authors, voyages, currentDate, focusShip, onOpenPanel, onOpenVoyageEntry, userLocation },
  ref
) {
  const mapRef = useRef(null);
  useImperativeHandle(ref, () => ({
    getMap: () => mapRef.current,
    flyTo: (lat, lng, zoom) => {
      if (mapRef.current) mapRef.current.flyTo([lat, lng], zoom, { duration: 1.2 });
    },
    flyToBounds: (bounds) => {
      if (mapRef.current) mapRef.current.flyToBounds(bounds.pad(0.3), { duration: 1.2 });
    },
  }));

  const diaryBounds = groups.length
    ? L.latLngBounds(groups.map((g) => [g[0].lat, g[0].lng]))
    : null;

  return (
    <MapContainer
      id="map"
      center={diaryBounds ? diaryBounds.getCenter() : [20, 0]}
      zoom={2}
      minZoom={2}
      zoomControl={false}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        maxZoom={19}
      />
      <MapController groups={groups} onSetMap={(m) => (mapRef.current = m)} userLocation={userLocation} />
      {mode === "diary" && <EntryMarkers groups={groups} authors={authors} onOpenPanel={onOpenPanel} />}
      {mode === "voyage" && voyages.length > 0 && (
        <VoyageLayer
          voyages={voyages}
          currentDate={currentDate}
          focusShip={focusShip}
          onOpenVoyageEntry={onOpenVoyageEntry}
        />
      )}
    </MapContainer>
  );
});

export default MapView;
