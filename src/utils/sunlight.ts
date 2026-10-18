// Same sunlight index the oxygen job uses. 1 is bright, mild weather.
// Weather data: Open-Meteo.com, CC BY 4.0. https://open-meteo.com/

const IDEAL_SHORTWAVE_W_M2 = 700;
const IDEAL_TEMP_MIN_C = 18;
const IDEAL_TEMP_MAX_C = 28;
const TEMP_FLOOR_C = 0;
const TEMP_CEILING_C = 42;
const CLEAR_SKY_ZENITH_W_M2 = 1050;
const DEG = Math.PI / 180;
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

type HourlyGardenWeather = {
  timeMs: number[];
  shortwaveWm2: (number | null)[];
  temperatureC: (number | null)[];
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function temperatureSuitability(temperatureC: number) {
  if (temperatureC <= TEMP_FLOOR_C || temperatureC >= TEMP_CEILING_C) {
    return 0;
  }
  if (temperatureC < IDEAL_TEMP_MIN_C) {
    return (temperatureC - TEMP_FLOOR_C) / (IDEAL_TEMP_MIN_C - TEMP_FLOOR_C);
  }
  if (temperatureC <= IDEAL_TEMP_MAX_C) {
    return 1;
  }
  return (TEMP_CEILING_C - temperatureC) / (TEMP_CEILING_C - IDEAL_TEMP_MAX_C);
}

function sunlightIndex(shortwaveWm2: number | null, temperatureC: number | null) {
  if (shortwaveWm2 == null || temperatureC == null) {
    return null;
  }
  if (!Number.isFinite(shortwaveWm2) || !Number.isFinite(temperatureC)) {
    return null;
  }
  const light = clamp01(Math.max(0, shortwaveWm2) / IDEAL_SHORTWAVE_W_M2);
  return light * temperatureSuitability(temperatureC);
}

function latestSunlightIndex(weather: HourlyGardenWeather, now: Date) {
  const nowMs = now.getTime();
  let latestTime = -Infinity;
  let latest: number | null = null;
  const count = Math.min(weather.timeMs.length, weather.shortwaveWm2.length, weather.temperatureC.length);
  for (let index = 0; index < count; index += 1) {
    const time = weather.timeMs[index];
    if (!Number.isFinite(time) || time > nowMs || time < latestTime) {
      continue;
    }
    const value = sunlightIndex(weather.shortwaveWm2[index], weather.temperatureC[index]);
    if (value == null) {
      continue;
    }
    latestTime = time;
    latest = value;
  }
  return latest;
}

function dayOfYearUtc(now: Date) {
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - start) / 86_400_000);
}

function solarElevationDegrees(now: Date, latitude: number, longitude: number) {
  const day = dayOfYearUtc(now);
  const b = ((360 / 365) * (day - 81)) * DEG;
  const declination = 23.44 * DEG * Math.sin(((360 / 365) * (day - 81)) * DEG);
  const equationOfTime = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const minutesUtc = now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60;
  const solarMinutes = minutesUtc + 4 * longitude + equationOfTime;
  const hourAngle = (solarMinutes / 4 - 180) * DEG;
  const lat = latitude * DEG;
  const sinElevation =
    Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  return Math.asin(Math.min(1, Math.max(-1, sinElevation))) / DEG;
}

/** Daylight estimate when the weather request has no reading yet. */
export function estimatedSunlightIndex(now: Date, latitude: number | null, longitude: number | null) {
  const elevation = solarElevationDegrees(now, latitude ?? 0, longitude ?? 0);
  if (elevation <= 0) {
    return 0;
  }
  const shortwave = CLEAR_SKY_ZENITH_W_M2 * Math.sin(elevation * DEG);
  return clamp01(shortwave / IDEAL_SHORTWAVE_W_M2);
}

async function fetchHourlyGardenWeather(latitude: number, longitude: number): Promise<HourlyGardenWeather> {
  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("hourly", "shortwave_radiation,temperature_2m");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("past_days", "1");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timeformat", "unixtime");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    hourly?: {
      time?: unknown[];
      shortwave_radiation?: unknown[];
      temperature_2m?: unknown[];
    };
  };
  const time = payload.hourly?.time;
  const shortwave = payload.hourly?.shortwave_radiation;
  const temperature = payload.hourly?.temperature_2m;
  if (!Array.isArray(time) || !Array.isArray(shortwave) || !Array.isArray(temperature)) {
    throw new Error("Open-Meteo response did not include hourly sunlight");
  }

  const asNumberOrNull = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  return {
    timeMs: time.map((value) => (typeof value === "number" ? value * 1000 : Number.NaN)),
    shortwaveWm2: shortwave.map(asNumberOrNull),
    temperatureC: temperature.map(asNumberOrNull),
  };
}

/** Real garden light index for this hour, from Open-Meteo when a location is known. */
export async function resolveSunlightIndex(
  now: Date,
  latitude: number | null,
  longitude: number | null,
) {
  if (latitude == null || longitude == null) {
    return estimatedSunlightIndex(now, null, null);
  }

  try {
    const weather = await fetchHourlyGardenWeather(latitude, longitude);
    return latestSunlightIndex(weather, now) ?? estimatedSunlightIndex(now, latitude, longitude);
  } catch {
    return estimatedSunlightIndex(now, latitude, longitude);
  }
}
