/**
 * Maps without an API key: OpenStreetMap's embeddable map for the preview, plain links for
 * directions (they open Google Maps / the phone's maps app), and OSM's Nominatim search for
 * turning an address into a pin — only when a manager asks for it.
 */

export interface Pin {
  lat: number;
  lng: number;
}

export function embedUrl({ lat, lng }: Pin, span = 0.008) {
  const bbox = [lng - span * 1.6, lat - span, lng + span * 1.6, lat + span].map((n) => n.toFixed(6)).join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}

/** Turn-by-turn directions from wherever the viewer is. Falls back to the address text without a pin. */
export function directionsUrl(pin: Pin | null, address?: string | null) {
  const destination = pin ? `${pin.lat},${pin.lng}` : (address ?? "");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

export function openMapUrl({ lat, lng }: Pin) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}

const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * Reads a pin from what people paste: "18.62, 73.84", or a Google Maps / OpenStreetMap link
 * (…/@18.62,73.84,15z, ?q=18.62,73.84, ?mlat=…&mlon=…, !3d18.62!4d73.84).
 */
export function parsePin(text: string): Pin | null {
  const t = text.trim();
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // Google place pin (more precise than the viewport)
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|destination|ll)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
    /mlat=(-?\d+(?:\.\d+)?).*mlon=(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (valid(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

/** Looks up an address with OpenStreetMap Nominatim. Returns null when nothing matches. */
export async function geocode(address: string): Promise<(Pin & { label: string }) | null> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error("The map search is unavailable right now");
  const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name } : null;
}

/** The device's current position (asks for permission). */
export function currentPosition(): Promise<Pin> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This device can't share its location"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? "Location access was blocked" : "Couldn't get your location")),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  });
}

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
