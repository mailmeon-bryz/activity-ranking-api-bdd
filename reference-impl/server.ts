/**
 * THROWAWAY reference implementation of the Activity Ranking API (branch `reference-impl`,
 * never merged). Its only job is to show the acceptance suite can go green, i.e. the suite
 * has no bugs of its own. Independent of the suite's code on purpose (no shared imports).
 *
 * Env: PORT, OPEN_METEO_GEOCODING_URL, OPEN_METEO_FORECAST_URL, OPEN_METEO_MARINE_URL,
 *      OPEN_METEO_TIMEOUT_MS
 */
import http from 'node:http';
import { z } from 'zod';
import { ACTIVITY_NAMES, band, rankDay, type DayWeather, type Waves } from './scoring';

/** Read lazily so a runner can set the env before the first request. */
const env = () => ({
  geocodingUrl:
    process.env.OPEN_METEO_GEOCODING_URL ?? 'https://geocoding-api.open-meteo.com/v1/search',
  forecastUrl: process.env.OPEN_METEO_FORECAST_URL ?? 'https://api.open-meteo.com/v1/forecast',
  marineUrl: process.env.OPEN_METEO_MARINE_URL ?? 'https://marine-api.open-meteo.com/v1/marine',
  timeoutMs: Number(process.env.OPEN_METEO_TIMEOUT_MS ?? 5000),
});

const FORECAST_VARS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'rain_sum',
  'snowfall_sum',
  'wind_speed_10m_max',
  'sunshine_duration',
] as const;
const MARINE_VARS = ['wave_height_max', 'wave_period_max'] as const;
const DAYS = 7;

// ---- Errors -------------------------------------------------------------------------------

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
const invalid = (message: string): ApiError => new ApiError(400, 'INVALID_REQUEST', message);
const unavailable = (): ApiError =>
  new ApiError(
    502,
    'UPSTREAM_UNAVAILABLE',
    'The weather provider is unavailable. Please try again shortly.',
  );

// ---- Upstream -----------------------------------------------------------------------------

async function upstream(
  url: string,
  params: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${url}?${new URLSearchParams(params)}`, {
      signal: AbortSignal.timeout(env().timeoutMs),
    });
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') {
      throw new ApiError(504, 'UPSTREAM_TIMEOUT', 'The weather provider took too long to respond.');
    }
    throw unavailable();
  }
  if (res.status >= 500) throw unavailable();
  try {
    return { status: res.status, body: await res.json() };
  } catch {
    throw unavailable();
  }
}

const GeoResult = z.object({
  id: z.number(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country_code: z.string(),
  country: z.string(),
  admin1: z.string().optional(),
  timezone: z.string(),
});
type GeoResult = z.infer<typeof GeoResult>;

const toLocation = (g: GeoResult) => ({
  id: g.id,
  name: g.name,
  region: g.admin1 ?? g.country,
  country: g.country,
  countryCode: g.country_code.toUpperCase(),
  latitude: g.latitude,
  longitude: g.longitude,
  timezone: g.timezone,
});
type Location = ReturnType<typeof toLocation>;

async function searchPlaces(name: string, count: number): Promise<GeoResult[]> {
  const { status, body } = await upstream(env().geocodingUrl, {
    name,
    count: String(count),
    language: 'en',
    format: 'json',
  });
  const parsed = z.object({ results: z.array(GeoResult).optional() }).safeParse(body);
  if (status !== 200 || !parsed.success) throw unavailable();
  return parsed.data.results ?? [];
}

async function placeById(id: string): Promise<GeoResult> {
  const { status, body } = await upstream(env().geocodingUrl.replace(/\/search$/, '/get'), { id });
  const parsed = GeoResult.safeParse(body);
  if (status === 200 && parsed.success) return parsed.data;
  if (status === 400 || status === 404)
    throw new ApiError(404, 'LOCATION_NOT_FOUND', `No location found with id ${id}.`);
  throw unavailable();
}

const Daily = (vars: readonly string[]) =>
  z.object({
    daily: z
      .object({ time: z.array(z.string()).length(DAYS) })
      .extend(
        Object.fromEntries(vars.map((v) => [v, z.array(z.number().nullable()).length(DAYS)])),
      ),
  });

async function forecast(loc: Location): Promise<{ dates: string[]; days: DayWeather[] }> {
  const { status, body } = await upstream(env().forecastUrl, {
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    daily: FORECAST_VARS.join(','),
    timezone: loc.timezone,
    forecast_days: String(DAYS),
  });
  const parsed = Daily(FORECAST_VARS).safeParse(body);
  if (status !== 200 || !parsed.success) throw unavailable();
  const d = parsed.data.daily as Record<string, (number | null)[]> & { time: string[] };
  const v = (name: string, i: number): number => {
    const value = d[name]?.[i];
    if (typeof value !== 'number') throw unavailable(); // no partial or made-up data
    return value;
  };
  const days = d.time.map((_, i) => ({
    weatherCode: v('weather_code', i),
    maxC: v('temperature_2m_max', i),
    minC: v('temperature_2m_min', i),
    precipitationMm: v('precipitation_sum', i),
    rainMm: v('rain_sum', i),
    snowfallCm: v('snowfall_sum', i),
    windKmh: v('wind_speed_10m_max', i),
    sunshineHours: v('sunshine_duration', i) / 3600,
  }));
  return { dates: d.time, days };
}

/** Wave data per day. A marine outage degrades surfing only (documented contract choice). */
async function waves(loc: Location): Promise<Waves[]> {
  try {
    const { status, body } = await upstream(env().marineUrl, {
      latitude: String(loc.latitude),
      longitude: String(loc.longitude),
      daily: MARINE_VARS.join(','),
      timezone: loc.timezone,
      forecast_days: String(DAYS),
    });
    const parsed = Daily(MARINE_VARS).safeParse(body);
    if (status !== 200 || !parsed.success) return Array(DAYS).fill('unavailable');
    const d = parsed.data.daily as Record<string, (number | null)[]>;
    return Array.from({ length: DAYS }, (_, i) => {
      const heightM = d['wave_height_max']?.[i];
      const periodS = d['wave_period_max']?.[i];
      return typeof heightM === 'number' && typeof periodS === 'number'
        ? { heightM, periodS }
        : 'none';
    });
  } catch {
    return Array(DAYS).fill('unavailable');
  }
}

// ---- Routes -------------------------------------------------------------------------------

const safe = (text: string): string => text.replace(/[<>]/g, '');

function textParam(params: URLSearchParams, name: string): string {
  const value = (params.get(name) ?? '').trim();
  if (value.length < 2 || value.length > 100)
    throw invalid(`${name} must be between 2 and 100 characters.`);
  return value;
}

async function locations(params: URLSearchParams): Promise<unknown> {
  const query = textParam(params, 'query');
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? 10 : Number(rawLimit);
  if (!/^\d+$/.test(rawLimit ?? '10') || limit < 1 || limit > 20) {
    throw invalid('limit must be a whole number from 1 to 20.');
  }
  return { query, results: (await searchPlaces(query, limit)).map(toLocation) };
}

async function resolveCity(city: string): Promise<Location> {
  const results = (await searchPlaces(city, 10)).map(toLocation);
  const exact = results.filter((r) => r.name.toLocaleLowerCase() === city.toLocaleLowerCase());
  const pool = exact.length > 0 ? exact : results;
  if (pool.length === 1) return pool[0] as Location;
  if (pool.length === 0)
    throw new ApiError(404, 'LOCATION_NOT_FOUND', `No location found matching "${safe(city)}".`);
  throw new ApiError(
    409,
    'AMBIGUOUS_LOCATION',
    `Several places match "${safe(city)}". Please pick one.`,
    {
      candidates: pool,
    },
  );
}

async function rankings(params: URLSearchParams): Promise<unknown> {
  const hasCity = params.has('city');
  const hasId = params.has('locationId');
  if (hasCity && hasId) throw invalid('Provide either city or locationId, not both.');
  if (!hasCity && !hasId) throw invalid('A city (or locationId) is required.');

  let location: Location;
  if (hasId) {
    const id = params.get('locationId') ?? '';
    if (!/^\d+$/.test(id)) throw invalid('locationId must be a positive whole number.');
    location = toLocation(await placeById(id));
  } else {
    location = await resolveCity(textParam(params, 'city'));
  }

  const [weather, sea] = await Promise.all([forecast(location), waves(location)]);
  return {
    location,
    generatedAt: new Date().toISOString(),
    forecastDays: DAYS,
    days: weather.days.map((day, i) => ({
      date: weather.dates[i],
      rankings: rankDay(day, sea[i] ?? 'unavailable').map((s) => ({
        rank: s.rank,
        activity: s.activity,
        activityName: ACTIVITY_NAMES[s.activity],
        score: s.score,
        suitability: band(s.score),
        reasons: s.reasons,
      })),
    })),
  };
}

const ROUTES: Record<string, (p: URLSearchParams) => Promise<unknown>> = {
  '/api/v1/locations': locations,
  '/api/v1/activity-rankings': rankings,
};

export function createReferenceServer(): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://reference');
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    const route = ROUTES[url.pathname];
    if (!route)
      return send(404, { error: { code: 'NOT_FOUND', message: 'No such endpoint.', details: {} } });
    route(url.searchParams)
      .then((body) => send(200, body))
      .catch((err: unknown) => {
        const e =
          err instanceof ApiError
            ? err
            : new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.');
        send(e.status, { error: { code: e.code, message: e.message, details: e.details } });
      });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3100);
  createReferenceServer().listen(port, () =>
    console.log(`Reference Activity Ranking API on http://localhost:${port}`),
  );
}
