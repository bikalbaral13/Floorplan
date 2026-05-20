/**
 * OSM map overlay support — Mercator math + tile-fetching helpers.
 *
 * Design choices for this minimal v1 (no rotation, integer zoom only):
 * - The user picks a geographic *anchor* (lat/lon) that pins to canvas world
 *   coord (0,0), plus an integer OSM zoom level. From those two values, every
 *   visible tile's world-space rectangle is fully determined.
 * - `pixelsPerMeter` is auto-derived from `cos(lat) * (earthCircumference / 2^zoom / TILE_SIZE)^-1`
 *   so existing distance labels and tracing tools immediately work in real
 *   metres. The map is just the visual backdrop — once scale is set, traced
 *   geometry has real-world dimensions even if the map is hidden later.
 *
 * Tile source: the OSM Foundation's public tile servers. Free, no API key.
 * Production use should swap to MapTiler / Stadia / Mapbox — single string
 * change. Attribution is rendered on-canvas while map is visible.
 */

export const TILE_SIZE = 256;
/** Earth's equatorial circumference in metres, per Web Mercator (EPSG:3857). */
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

/** Standard slippy-map projection: lat/lon → fractional tile X/Y at zoom Z.
 *  See https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames. */
export const latLonToTile = (lat: number, lon: number, zoom: number) => {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
};

/** Inverse projection: fractional tile X/Y → lat/lon (for centroid lookups, debug). */
export const tileToLatLon = (x: number, y: number, zoom: number) => {
  const n = 2 ** zoom;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lon };
};

/** Web Mercator ground resolution: how many real-world metres one tile pixel
 *  represents at a given latitude + integer zoom level. */
export const metresPerTilePixel = (lat: number, zoom: number) => {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * 2 ** zoom);
};

/** Inverse of the above — `pixelsPerMeter` value to feed into the editor's
 *  scale system so that 1 canvas pixel == 1 tile pixel. Distance labels then
 *  read out in real metres at the anchor latitude. */
export const pixelsPerMeterFromMap = (lat: number, zoom: number) => {
  return 1 / metresPerTilePixel(lat, zoom);
};

/** OSM tile URL. We keep the subdomain pool implicit — modern hosting (and
 *  most browsers' HTTP/2) means a single hostname is fine; rotating is no
 *  longer necessary. Switch this to a paid provider for production. */
export const osmTileUrl = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

/** Image-element cache keyed by tile URL. Lifetime = the page session; the
 *  browser HTTP cache stores the underlying bytes for longer. */
const tileImageCache = new Map<string, HTMLImageElement>();

/** Load (or return cached) tile as a fully-decoded HTMLImageElement.
 *  Resolves null on network errors so the caller can skip drawing that tile. */
export const loadTileImage = (url: string): Promise<HTMLImageElement | null> => {
  const cached = tileImageCache.get(url);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }
  if (cached) {
    // Tile is mid-load — wait for the existing element instead of starting another fetch.
    return new Promise((resolve) => {
      cached.addEventListener("load", () => resolve(cached), { once: true });
      cached.addEventListener("error", () => resolve(null), { once: true });
    });
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
    tileImageCache.set(url, img);
  });
};

/** Nominatim geocoding result (only the fields we use). */
export interface NominatimHit {
  lat: number;
  lon: number;
  displayName: string;
}

/** Search OSM Nominatim for a place name. Free, no API key, but the OSM
 *  usage policy says: identify yourself via User-Agent / Referer, don't
 *  autocomplete-on-every-keystroke, max ~1 req/s. We debounce in the UI to
 *  one fetch per Enter / button click. */
export const searchNominatim = async (query: string): Promise<NominatimHit[]> => {
  if (!query.trim()) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      // Nominatim asks for a meaningful UA identifying the app. The browser
      // appends its own UA after this, which is fine.
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Nominatim search failed: ${res.status}`);
  const json = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  return json.map((h) => ({ lat: parseFloat(h.lat), lon: parseFloat(h.lon), displayName: h.display_name }));
};
