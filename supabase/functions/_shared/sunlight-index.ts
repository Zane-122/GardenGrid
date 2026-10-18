// Plant sunlight index from Open-Meteo hourly weather. 1 is bright, mild
// conditions where photosynthesis is not limited by light or temperature.

/** Global horizontal shortwave irradiance at which garden plants are light-saturated. */
export const IDEAL_SHORTWAVE_W_M2 = 700;

/** Temperature band that does not limit photosynthesis. */
export const IDEAL_TEMP_MIN_C = 18;
export const IDEAL_TEMP_MAX_C = 28;

/** Outside this range, temperature stops photosynthesis. */
export const TEMP_FLOOR_C = 0;
export const TEMP_CEILING_C = 42;

/** Clear-sky irradiance on a horizontal surface when the sun is overhead. */
const CLEAR_SKY_ZENITH_W_M2 = 1050;
const DEG = Math.PI / 180;

export type HourlyGardenWeather = {
  /** Unix milliseconds. Open-Meteo shortwave at this time is the preceding hour's mean. */
  timeMs: number[];
  shortwaveWm2: (number | null)[];
  temperatureC: (number | null)[];
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function temperatureSuitability(temperatureC: number) {
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

/** 0–1, or null when either measurement is missing. */
export function sunlightIndex(
  shortwaveWm2: number | null | undefined,
  temperatureC: number | null | undefined
): number | null {
  if (typeof shortwaveWm2 !== 'number' || typeof temperatureC !== 'number') {
    return null;
  }
  if (!Number.isFinite(shortwaveWm2) || !Number.isFinite(temperatureC)) {
    return null;
  }
  const light = clamp01(Math.max(0, shortwaveWm2) / IDEAL_SHORTWAVE_W_M2);
  return light * temperatureSuitability(temperatureC);
}

/**
 * Sunlight index from the latest hourly reading at or before `now`.
 * Later hours are ignored. Null when every reading is missing or still in the future.
 */
export function latestSunlightIndex(weather: HourlyGardenWeather, now: Date): number | null {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    return null;
  }

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

/** Solar elevation in degrees. Negative means the sun is below the horizon. */
export function solarElevationDegrees(now: Date, latitude: number, longitude: number) {
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

/**
 * Daylight estimate when weather is missing. 0 at night, 1 once clear-sky sun
 * would reach the ideal irradiance. Without a location, solar noon is 12:00 UTC.
 */
export function estimatedSunlightIndex(now: Date, latitude: number | null, longitude: number | null) {
  const elevation = solarElevationDegrees(now, latitude ?? 0, longitude ?? 0);
  if (elevation <= 0) {
    return 0;
  }
  const shortwave = CLEAR_SKY_ZENITH_W_M2 * Math.sin(elevation * DEG);
  return clamp01(shortwave / IDEAL_SHORTWAVE_W_M2);
}

if (import.meta.main) {
  const check = (name: string, actual: number | null, expected: number | null) => {
    const pass =
      actual === expected ||
      (actual != null && expected != null && Math.abs(actual - expected) <= 1e-9);
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}: got ${actual}, expected ${expected}`);
    if (!pass) Deno.exit(1);
  };

  check('night is 0', sunlightIndex(0, 22), 0);
  check('ideal light and temperature is 1', sunlightIndex(700, 22), 1);
  check('brighter than ideal stays 1', sunlightIndex(1100, 22), 1);
  check('half light is 0.5', sunlightIndex(350, 22), 0.5);
  check('cool morning is limited by temperature', sunlightIndex(700, 9), 0.5);
  check('hot afternoon is limited by temperature', sunlightIndex(700, 35), 0.5);
  check('freezing is 0', sunlightIndex(700, -5), 0);
  check('extreme heat is 0', sunlightIndex(700, 50), 0);
  check('missing light is null', sunlightIndex(null, 22), null);

  const hour = 3_600_000;
  const start = Date.UTC(2026, 9, 17, 12, 0, 0);
  const weather: HourlyGardenWeather = {
    timeMs: [start, start + hour],
    shortwaveWm2: [700, 0],
    temperatureC: [22, 22],
  };
  check('latest reading ignores the earlier hour', latestSunlightIndex(weather, new Date(start + hour)), 0);
  check('a future hour is not used yet', latestSunlightIndex(weather, new Date(start)), 1);
  check('no reading yet is null', latestSunlightIndex(weather, new Date(start - hour)), null);

  const evening = new Date('2026-10-17T23:00:00Z');
  const afternoon = new Date('2026-10-17T17:00:00Z');
  check('7 PM at the garden is night', estimatedSunlightIndex(evening, 42.34, -83.52), 0);
  const afternoonIndex = estimatedSunlightIndex(afternoon, 42.34, -83.52);
  check('1 PM at the garden is bright', afternoonIndex != null && afternoonIndex > 0.5 ? 1 : 0, 1);
  check('midnight UTC with no location is night', estimatedSunlightIndex(new Date('2026-10-17T00:00:00Z'), null, null), 0);
  check('solar noon UTC with no location is full', estimatedSunlightIndex(new Date('2026-06-21T12:00:00Z'), null, null), 1);
}
