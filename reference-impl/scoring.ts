/**
 * THROWAWAY reference scoring, written only to prove the acceptance suite can pass.
 * It is deliberately simple and is NOT a proposal for the real formula.
 */

export type Activity = 'SKIING' | 'SURFING' | 'OUTDOOR_SIGHTSEEING' | 'INDOOR_SIGHTSEEING';
export type Suitability = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';

/** Fixed tie-break order (and display order for equal scores). */
export const ACTIVITY_ORDER: Activity[] = [
  'SKIING',
  'SURFING',
  'OUTDOOR_SIGHTSEEING',
  'INDOOR_SIGHTSEEING',
];

export const ACTIVITY_NAMES: Record<Activity, string> = {
  SKIING: 'Skiing',
  SURFING: 'Surfing',
  OUTDOOR_SIGHTSEEING: 'Outdoor Sightseeing',
  INDOOR_SIGHTSEEING: 'Indoor Sightseeing',
};

export interface DayWeather {
  weatherCode: number;
  maxC: number;
  minC: number;
  precipitationMm: number;
  rainMm: number;
  snowfallCm: number;
  windKmh: number;
  sunshineHours: number;
}

/** Wave data for the day: values, none at this place (null), or the marine API was down. */
export type Waves = { heightM: number; periodS: number } | 'none' | 'unavailable';

export interface Scored {
  activity: Activity;
  score: number;
  reasons: string[];
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
const r = (n: number): number => Math.round(n) || 0; // avoids "-0"
const isThunder = (code: number): boolean => code >= 95;

export function band(score: number): Suitability {
  if (score >= 80) return 'EXCELLENT';
  if (score >= 60) return 'GOOD';
  if (score >= 40) return 'FAIR';
  return 'POOR';
}

function skiing(w: DayWeather): Scored {
  const snow = (Math.min(w.snowfallCm, 30) / 30) * 40;
  const cold = w.maxC <= 0 ? 35 : w.maxC <= 3 ? 25 : w.maxC <= 6 ? 10 : 0;
  const snowpack = w.minC <= -5 ? 15 : 0;
  const sun = w.maxC <= 6 ? Math.min(w.sunshineHours, 6) * 2 : 0;
  const wind = w.windKmh > 50 ? 25 : w.windKmh > 35 ? 10 : 0;

  const reasons: string[] = [];
  if (w.snowfallCm >= 10) reasons.push(`Heavy snowfall expected (${r(w.snowfallCm)} cm)`);
  else if (w.snowfallCm > 0)
    reasons.push(`Light snowfall expected (${w.snowfallCm.toFixed(1)} cm)`);
  else reasons.push('No fresh snow forecast');
  if (w.maxC <= 0)
    reasons.push(`Sub-zero temperatures keep the snow firm (high of ${r(w.maxC)}°C)`);
  else if (w.maxC > 6) reasons.push(`Too warm for good snow (${r(w.maxC)}°C)`);
  if (wind > 0) reasons.push(`Strong winds up to ${r(w.windKmh)} km/h may close lifts`);
  return { activity: 'SKIING', score: clamp(snow + cold + snowpack + sun - wind), reasons };
}

function surfing(w: DayWeather, waves: Waves): Scored {
  if (waves === 'unavailable') {
    return {
      activity: 'SURFING',
      score: 0,
      reasons: ['Wave data is unavailable right now, so surfing cannot be rated'],
    };
  }
  if (waves === 'none') {
    return {
      activity: 'SURFING',
      score: 0,
      reasons: ['No wave data for this location (no coastline nearby)'],
    };
  }
  const h = waves.heightM;
  const size = h < 0.5 ? 5 : h < 1 ? 25 : h < 1.5 ? 45 : h <= 4 ? 65 : 45;
  const period = waves.periodS >= 12 ? 15 : waves.periodS >= 9 ? 8 : 0;
  const wind = w.windKmh > 40 ? 30 : w.windKmh > 25 ? 10 : 0;
  const cold = w.maxC < 5 ? 10 : 0;
  const storm = isThunder(w.weatherCode) ? 30 : 0;

  const reasons = [
    h < 0.5
      ? `Small waves (${h.toFixed(1)} m)`
      : `Waves up to ${h.toFixed(1)} m with a ${r(waves.periodS)} s period`,
  ];
  if (wind > 0) reasons.push(`Wind up to ${r(w.windKmh)} km/h may make the sea choppy`);
  if (cold > 0) reasons.push(`Cold air (${r(w.maxC)}°C), a thick wetsuit is needed`);
  if (storm > 0) reasons.push('Thunderstorms make the water unsafe');
  return { activity: 'SURFING', score: clamp(size + period - wind - cold - storm), reasons };
}

function outdoor(w: DayWeather): Scored {
  const t = w.maxC;
  const temp =
    t >= 18 && t <= 26
      ? 40
      : (t >= 12 && t < 18) || (t > 26 && t <= 30)
        ? 25
        : (t >= 5 && t < 12) || (t > 30 && t <= 34)
          ? 12
          : 0;
  const sky = Math.min(w.sunshineHours, 10) * 3;
  const wet = Math.min(w.precipitationMm * 2, 40);
  const wind = w.windKmh > 60 ? 40 : w.windKmh > 40 ? 20 : w.windKmh > 25 ? 8 : 0;
  const storm = isThunder(w.weatherCode) ? 30 : 0;

  const reasons: string[] = [];
  if (w.weatherCode <= 1 && w.sunshineHours >= 8) reasons.push(`Clear skies and ${r(t)}°C`);
  else if (w.sunshineHours >= 5) reasons.push(`Sunny spells and ${r(t)}°C`);
  else reasons.push(`Mostly cloudy with a high of ${r(t)}°C`);
  reasons.push(...negativeDrivers(w));
  if (t > 30) reasons.push(`Very hot (${r(t)}°C), so plan for shade`);
  return {
    activity: 'OUTDOOR_SIGHTSEEING',
    score: clamp(30 + temp + sky - wet - wind - storm),
    reasons,
  };
}

/** Weather that spoils a day outside; shared by the outdoor and indoor reasons. */
function negativeDrivers(w: DayWeather): string[] {
  const out: string[] = [];
  if (isThunder(w.weatherCode)) out.push('Thunderstorms forecast');
  if (w.snowfallCm >= 1) out.push(`Snow expected (${r(w.snowfallCm)} cm)`);
  if (w.rainMm >= 10) out.push(`Heavy rain expected (${r(w.rainMm)} mm)`);
  else if (w.rainMm >= 1) out.push(`Showers likely (${r(w.rainMm)} mm of rain)`);
  if (w.windKmh > 60) out.push(`Gale-force winds up to ${r(w.windKmh)} km/h`);
  else if (w.windKmh > 40) out.push(`Strong winds up to ${r(w.windKmh)} km/h`);
  return out;
}

function indoor(w: DayWeather, outdoorScore: number): Scored {
  const score = clamp(25 + (100 - outdoorScore) * 0.45);
  const reasons =
    outdoorScore < 40
      ? ['A good day for museums and galleries', ...negativeDrivers(w)]
      : outdoorScore >= 70
        ? ['Fine weather outside, so indoor sights are less of a draw']
        : ['Indoor sights are a solid choice in mixed weather'];
  return { activity: 'INDOOR_SIGHTSEEING', score, reasons };
}

export interface Ranked extends Scored {
  rank: number;
}

/** Scores all four activities for one day and ranks them (score desc, then fixed order). */
export function rankDay(w: DayWeather, waves: Waves): Ranked[] {
  const out = outdoor(w);
  const scored = [skiing(w), surfing(w, waves), out, indoor(w, out.score)];
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        ACTIVITY_ORDER.indexOf(a.activity) - ACTIVITY_ORDER.indexOf(b.activity),
    )
    .map((s, i) => ({ ...s, rank: i + 1 }));
}
