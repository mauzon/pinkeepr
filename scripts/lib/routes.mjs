/** Shared walk/taxi route math from an origin point to a place. */

export function coordsMatch(a, b, eps = 1e-5) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return false;
  return Math.abs(a.lat - b.lat) <= eps && Math.abs(a.lng - b.lng) <= eps;
}

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function cacheKey(lat1, lng1, lat2, lng2) {
  return `${lat1},${lng1}->${lat2},${lng2}`;
}

export function fmtKm(km, locale = "ru") {
  const s = km.toFixed(1);
  return locale === "ru" ? s.replace(".", ",") : s;
}

function roundVnd(n) {
  return Math.round(n / 1000) * 1000;
}

export function formatFareRange(low, high, currency, locale) {
  if (currency === "VND") {
    if (locale === "en") {
      const a = low.toLocaleString("en-US");
      const b = high.toLocaleString("en-US");
      return `${a}–${b}₫`;
    }
    const fmt = (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `${fmt(low)}–${fmt(high)} ₫`;
  }
  if (currency === "THB") {
    if (locale === "en") return `฿${low}–${high}`;
    return `${low}–${high} ฿`;
  }
  if (currency === "GBP") {
    const lo = Number.isInteger(low) ? low : low.toFixed(1);
    const hi = Number.isInteger(high) ? high : high.toFixed(1);
    if (locale === "en") return `£${lo}–${hi}`;
    return `${String(lo).replace(".", ",")}–${String(hi).replace(".", ",")} £`;
  }
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency;
  if (locale === "en") return `${sym}${low}–${high}`;
  return `${low}–${high} ${sym}`;
}

export function taxiFare(km, taxiModel, currency = "THB") {
  if (currency === "VND") {
    const includedKm = taxiModel.included_km ?? 2;
    const baseLow = taxiModel.base_fare_min ?? taxiModel.base_fare_thb ?? 25_000;
    const baseHigh =
      taxiModel.base_fare_max ?? Math.max(baseLow + 5000, Math.round(baseLow * 1.2));
    const perLow = taxiModel.per_km_min ?? taxiModel.per_km_thb_min ?? 12_000;
    const perHigh = taxiModel.per_km_max ?? taxiModel.per_km_thb_max ?? 16_000;
    const extra = Math.max(0, km - includedKm);
    let low = roundVnd(baseLow + extra * perLow);
    let high = roundVnd(baseHigh + extra * perHigh);
    if (high <= low) high = low + 1000;
    return { low, high };
  }
  const base = taxiModel.base_fare_thb;
  const extraKm = Math.max(0, km - 1);
  const low = Math.round(base + extraKm * taxiModel.per_km_thb_min);
  const high = Math.round(base + extraKm * taxiModel.per_km_thb_max);
  return { low: Math.max(low, base), high: Math.max(high, low + 10) };
}

export function buildRouteBundle(origin, place, drive, city, locale = "ru") {
  const taxiModel = city.transport.taxi;
  const traffic = taxiModel.traffic_factor;
  const walkSpeed = city.routing?.walk_speed_kmh ?? 4.7;
  const currency = city.currency || "THB";

  const walkKm = haversineKm(origin, place) * 1.25;
  const walkMin = Math.round((walkKm / walkSpeed) * 60);
  const walkPractical = walkKm <= 3.5;
  const walkLabel =
    locale === "en"
      ? walkPractical
        ? `${walkMin} min · ${fmtKm(walkKm, "en")} km`
        : `far (~${fmtKm(walkKm, "en")} km)`
      : walkPractical
        ? `${walkMin} мин · ${fmtKm(walkKm)} км`
        : `далеко (~${fmtKm(walkKm)} км)`;

  const km = drive.distance_m / 1000;
  const minBase = (drive.duration_s / 60) * traffic;
  const minLow = Math.max(1, Math.round(minBase * 0.85));
  const minHigh = Math.max(minLow + 1, Math.round(minBase * 1.15));
  const fare = taxiFare(km, taxiModel, currency);
  const fareStr = formatFareRange(fare.low, fare.high, currency, locale);
  const taxiLabel =
    locale === "en"
      ? `${minLow}–${minHigh} min · ${fmtKm(km, "en")} km · ${fareStr}`
      : `${minLow}–${minHigh} мин · ${fmtKm(km)} км · ${fareStr}`;

  return {
    walk: { km: walkKm, min: walkMin, practical: walkPractical, label: walkLabel },
    taxi: {
      km,
      min_low: minLow,
      min_high: minHigh,
      thb_min: fare.low,
      thb_max: fare.high,
      label: taxiLabel,
    },
    sort_km: km,
  };
}

/** Russian primary labels with English copies in walk.label_en / taxi.label_en (matches enrich-routes). */
export function buildBilingualRouteBundle(origin, place, drive, city) {
  const ru = buildRouteBundle(origin, place, drive, city, "ru");
  const en = buildRouteBundle(origin, place, drive, city, "en");
  if (ru.walk) ru.walk.label_en = en.walk.label;
  if (ru.taxi) ru.taxi.label_en = en.taxi.label;
  return ru;
}

export function defaultOriginId(city) {
  if (!city.origins?.length) return "hotel";
  return city.origins.find((o) => o.default)?.id ?? city.origins[0].id;
}

export function syncLegacyRoutes(place, originId) {
  const r = place.routes?.[originId];
  if (!r) return;
  place.walk = r.walk;
  place.taxi = r.taxi;
  if (r.transit) place.transit = r.transit;
  place.sort_km = r.sort_km;
}