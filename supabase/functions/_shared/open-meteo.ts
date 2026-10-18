import { type HourlyGardenWeather } from './sunlight-index.ts';

// Weather data: Open-Meteo.com, CC BY 4.0. https://open-meteo.com/
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Hourly shortwave radiation and temperature covering yesterday and today, in UTC. */
export async function fetchHourlyGardenWeather(
  latitude: number,
  longitude: number
): Promise<HourlyGardenWeather> {
  const url = new URL(FORECAST_URL);
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('hourly', 'shortwave_radiation,temperature_2m');
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('past_days', '1');
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('timeformat', 'unixtime');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed (${response.status})`);
  }

  const payload = await response.json().catch(() => null);
  const hourly = payload?.hourly;
  const time = hourly?.time;
  const shortwave = hourly?.shortwave_radiation;
  const temperature = hourly?.temperature_2m;
  if (!Array.isArray(time) || !Array.isArray(shortwave) || !Array.isArray(temperature)) {
    throw new Error('Open-Meteo response did not include hourly sunlight');
  }

  return {
    timeMs: time.map((value: unknown) => (typeof value === 'number' ? value * 1000 : Number.NaN)),
    shortwaveWm2: shortwave.map(asNumberOrNull),
    temperatureC: temperature.map(asNumberOrNull),
  };
}
