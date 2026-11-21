# Activity Ranking API: specification-first BDD suite

> **You are on the `reference-impl` branch.** It adds a throwaway implementation in
> [`reference-impl/`](reference-impl) so that the **unchanged** suite can be shown green:
> `npm run test:reference` → `78 scenarios (78 passed)`. The service and its scoring formula
> are deliberately simple and are **not** a proposal for the real API. This branch is never
> merged; `main` holds the spec-first suite, which is red by design.

Acceptance tests, written **before the code exists**, for an API that takes a city or town and
returns a 7-day ranked list of activities (Skiing, Surfing, Outdoor Sightseeing, Indoor
Sightseeing) based on the Open-Meteo forecast.

**The build is red on purpose.** There is no implementation yet. A placeholder service answers
`501 Not Implemented` on every route, so every scenario fails on a behavioural assertion such as
`Expected HTTP 200 (activity rankings returned) but received HTTP 501`. Nothing fails on
connection errors, undefined steps or TypeScript errors. Once the API is built, the same suite,
pointed at it with `API_BASE_URL`, becomes its acceptance gate.

|            |                                                                                         |
| ---------- | --------------------------------------------------------------------------------------- |
| Stack      | TypeScript (strict) · Cucumber.js · zod · `expect` · Node's built-in `fetch` and `http` |
| Scenarios  | 43 written (78 once outlines expand), plus 3 opt-in `@live`                             |
| Open-Meteo | Fully stubbed by a programmable in-process server; the default run needs no network     |

---

## How to run

Prerequisites: Node 24 LTS (see `.nvmrc`; Node 22 or later works).

```bash
npm ci
npm test              # full suite against the 501 placeholder → red (expected)
npm run test:smoke    # @smoke subset
npm run test:dry      # cucumber --dry-run --strict: fails if any step is undefined/pending
npm run typecheck && npm run lint
npm run test:live     # @live: hits the real Open-Meteo to detect fixture drift (needs network)
```

Reports are written to `reports/cucumber-report.html` and `.json`.

**Against a real implementation**

```bash
API_BASE_URL=http://localhost:8080 npm test
```

When `API_BASE_URL` is set, the placeholder is not started. The implementation must read its
upstream URLs from the environment so that it talks to the stub, which listens on `STUB_PORT`
(default 4010):

| Env var (read by the API)  | Value for the tests                      | Real value                                       |
| -------------------------- | ---------------------------------------- | ------------------------------------------------ |
| `OPEN_METEO_GEOCODING_URL` | `http://localhost:4010/geocoding/search` | `https://geocoding-api.open-meteo.com/v1/search` |
| `OPEN_METEO_FORECAST_URL`  | `http://localhost:4010/forecast`         | `https://api.open-meteo.com/v1/forecast`         |
| `OPEN_METEO_MARINE_URL`    | `http://localhost:4010/marine`           | `https://marine-api.open-meteo.com/v1/marine`    |
| `OPEN_METEO_TIMEOUT_MS`    | `5000`                                   |                                                  |

Look-ups by id use the geocoding sibling route `/geocoding/get?id=` (real: `/v1/get`).

---

## Approach

- **Spec-first BDD.** The feature files were written and reviewed before any automation. They
  use the domain's declarative language ("When I request activity rankings for "Zermatt""), not
  HTTP details. The only HTTP-level inputs appear in the validation outlines, where the raw
  input _is_ what is being tested.
- **Front-end UX is part of "fit for purpose".** Scenarios cover autocomplete (partial names,
  case and whitespace, accents, an empty list being a normal state), telling similar names apart
  (region and country), a 409 response with a candidate list for the UI's picker, display-ready
  `activityName` and reasons, stable ordering, and errors that are safe to show to users.
- **Relative, metamorphic ranking assertions.** The scoring formula belongs to the developers, so
  the suite never asserts an exact score. It asserts outcomes ("Skiing ranks 1st in heavy snow",
  "Surfing ranks above Skiing in a big swell") and invariants ("with everything else equal, more
  snow never lowers the Skiing score; more rain never raises the Outdoor score").
- **Contract as code.** `src/contract/schemas.ts` (zod) is the executable contract and the source
  of every TypeScript type (`z.infer`). Schema failures list each offending JSON path.
- **Failures readable by a developer who has never seen the suite.** Each failure states what was
  expected, what was received, the request and the truncated body. Per-day rules list _every_
  bad day, not just the first. On failure, the HTML report also shows what the service sent to
  Open-Meteo.
- **Thin steps.** Logic lives in `assertions/`, `stubs/` and `clients/`. Cucumber parameter types
  (`{activity}`, `{suitability}`, `{ordinal}`) keep the Gherkin natural.

### Tags

| Tag           | Scenarios | Purpose                                               |
| ------------- | --------- | ----------------------------------------------------- |
| `@search`     | 23        | Location search / autocomplete                        |
| `@contract`   | 9         | Response shape, days, ranks, bands, tie-break         |
| `@ranking`    | 14        | Weather → ranking rules, including metamorphic checks |
| `@reasoning`  | 7         | Human-readable reasons                                |
| `@validation` | 22        | 400 / 404 / 409 handling                              |
| `@resilience` | 12        | Open-Meteo faults, timeouts, request parameters sent  |
| `@ux`         | 32        | Behaviour driven by the front end                     |
| `@smoke`      | 11        | Fast, high-value subset                               |
| `@live`       | 3         | Real Open-Meteo drift check (excluded by default)     |

Counts are executed scenarios, after outline expansion.

---

## API contract (assumed)

All responses are JSON. Base URL: `API_BASE_URL` (default `http://localhost:3000`).

### `GET /api/v1/locations?query={text}[&limit={1-20}]`

`query` is trimmed and must be 2 to 100 characters; matching is case-insensitive and
Unicode-safe. `limit` defaults to 10, with a maximum of 20. Results are in relevance order. No
matches returns **200 with `results: []`**, because an empty autocomplete list is a normal
state, not an error.

```json
{
  "query": "Lon",
  "results": [
    {
      "id": 2643743,
      "name": "London",
      "region": "England",
      "country": "United Kingdom",
      "countryCode": "GB",
      "latitude": 51.50853,
      "longitude": -0.12574,
      "timezone": "Europe/London"
    }
  ]
}
```

### `GET /api/v1/activity-rankings?city={name}` or `?locationId={id}`

Exactly one of the two is required. The intended front-end flow is search → pick → rank by
`locationId`.

```json
{
  "location": {
    "id": 2657928,
    "name": "Zermatt",
    "country": "Switzerland",
    "latitude": 46.02126,
    "longitude": 7.74912,
    "timezone": "Europe/Zurich"
  },
  "generatedAt": "2026-11-21T09:00:00Z",
  "forecastDays": 7,
  "days": [
    {
      "date": "2026-11-21",
      "rankings": [
        {
          "rank": 1,
          "activity": "SKIING",
          "activityName": "Skiing",
          "score": 91,
          "suitability": "EXCELLENT",
          "reasons": ["Heavy snowfall expected (35 cm)", "Cold: -6°C"]
        }
      ]
    }
  ]
}
```

Rules the suite pins down:

- 7 consecutive ISO dates, starting **today in the location's timezone**
- Each day lists all 4 activities exactly once; `rank` runs 1 to 4, sorted by `score` descending
- `score` is an integer from 0 to 100. `suitability` is derived from it: `EXCELLENT` 80–100,
  `GOOD` 60–79, `FAIR` 40–59, `POOR` 0–39
- **Tie-break:** equal scores are ordered `SKIING` → `SURFING` → `OUTDOOR_SIGHTSEEING` →
  `INDOOR_SIGHTSEEING` (the ticket's order), so the UI never reshuffles
- `reasons` is non-empty, plain English, at most 120 characters each, metric units only, and
  contains no raw codes (`weather_code`, `WMO`, `null`, snake_case field names)

### Errors: `{ "error": { "code", "message", "details" } }`

| Situation                                                                                                                                  | Status | `code`                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------- |
| Missing, blank or whitespace-only input; length < 2 or > 100; both `city` and `locationId`; non-integer `locationId`; `limit` out of range | 400    | `INVALID_REQUEST` (message names the parameter)                              |
| No match / unknown `locationId`                                                                                                            | 404    | `LOCATION_NOT_FOUND`                                                         |
| Name matches several places ("Springfield")                                                                                                | 409    | `AMBIGUOUS_LOCATION`; `details.candidates` has the `/locations` result shape |
| Open-Meteo 5xx, error body, invalid JSON, missing, short or null-gapped data                                                               | 502    | `UPSTREAM_UNAVAILABLE`                                                       |
| Open-Meteo slower than `OPEN_METEO_TIMEOUT_MS`                                                                                             | 504    | `UPSTREAM_TIMEOUT`                                                           |

Errors are always `application/json`, with no stack traces and no upstream URLs. Validation
failures must not call Open-Meteo at all, and the stub verifies this.

---

## Open-Meteo strategy: service virtualisation

`src/stubs/openMeteoStub.ts` is a small programmable HTTP server built on Node's `http` module.
It is started in `BeforeAll` and reset in `Before`, so scenarios are independent and can run in
any order.

- **Named fixtures** (`test/fixtures/open-meteo/`): a reference place-name directory (42 places,
  including the ambiguous Londons and Springfields and 25 "San…" places for limit tests), 10
  forecast profiles (`heavy-snow-alpine`, `big-swell-coastal`, `storm-week`, …) and 3 marine
  profiles. Scenarios can also describe a week inline with a data table.
- **Date-relative:** fixtures hold values only. The stub generates the `time` array from today in
  the _requested_ timezone, so the tests never go stale.
- **Realistic:** parameter names, response shapes, units, the 2-character exact-match and
  3-or-more-character prefix rule for geocoding, the marine API's 5-day default, and the
  `{"error": true, "reason"}` error body were all taken from the live Open-Meteo docs. The stub
  only returns the `daily` variables the service asks for, as the real API does. Every response
  it builds is validated against `src/contract/openMeteoSchemas.ts`.
- **Fault injection:** 500 errors, invalid JSON, a missing `daily` block, missing variables, only
  3 days, Open-Meteo error bodies, and a 10-second delay.
- **Request recording:** scenarios assert the service sent the resolved lat/long,
  `forecast_days=7`, the location's `timezone` and metric units, requested 7 days of wave data
  (overriding the marine default of 5), and made **no** calls when validation failed.
- **`@live` drift check:** three opt-in scenarios call the real Open-Meteo APIs and validate the
  responses against the _same_ schemas and units the fixtures use. They passed when last run. If
  Open-Meteo changes shape, this check fails before anyone notices the offline suite drifting
  from reality.

Why: the tests are deterministic and offline, can produce extreme weather on demand, can test
failure modes the real API cannot be made to produce, and check the integration contract itself.
The trade-off is that a stub can drift from reality, which is what `@live` exists to catch.

---

## Assumptions

1. The 7 days start **today in the location's timezone** (Auckland and Honolulu are checked
   against UTC). Expected dates are computed with `Intl` at run time; a run that crosses local
   midnight between request and assertion could, very rarely, flake.
2. Metric units throughout (°C, mm, cm, km/h, m). Reasons are English only.
3. `city` must resolve to **exactly one** place, otherwise the API returns 409 with candidates.
   This applies even to well-known names: `city=London` is ambiguous (GB and CA), so the
   happy-path tests use unique places such as Zermatt.
4. Surfing uses the Open-Meteo **marine** API (`wave_height_max`, `wave_period_max`,
   `swell_wave_height_max`). For inland places the docs don't say what is returned; the fixtures
   assume **all-null values**, and Surfing must then be `POOR`, with a reason saying there is no
   coast or wave data.
5. **Marine API down, forecast up → graceful degradation:** the service still returns 200 with
   the other activities ranked normally, and Surfing rated `POOR` with a reason saying wave data
   is unavailable. A 502 for the whole request would hide a usable forecast from the user.
6. Injection-like input (`'; DROP TABLE…`, `<script>`) may return **400 or 404**. Real place
   names contain apostrophes (L'Aquila), so blanket rejection would be wrong. The requirement is
   a safe envelope with no HTML in the message.
7. Rankings take no `limit`. A non-integer `locationId` (`abc`, `12.5`) is a 400.
8. Validation (400) happens before any upstream call.

## Omissions and trade-offs

- **No exact scores or formula.** The developers own the formula; relative and metamorphic
  assertions keep the suite valid if it is tuned.
- **Score-band boundaries** (39/40, 59/60, 79/80) are expressed as a data table checked against
  every score returned, not as a boundary-value outline. Black-box tests cannot force the
  service to output exactly 40.
- **The tie-break** check uses a hot, dry inland week, where Skiing and Surfing should both
  bottom out. If the implementation never produces a tie there, the check passes without being
  exercised.
- **Proving the suite itself:** a throwaway reference implementation lives on the
  [`reference-impl`](../../tree/reference-impl) branch, which is never merged. Against it, the
  suite is fully green (`npm run test:reference` on that branch). It also found one real bug in
  the suite: step arity, now fixed. **Mutation check:** 7 bugs were deliberately planted, and the
  suite caught 5. The two survivors were a "null forecast values become 0" bug, which led to a
  null-gap scenario that now catches it, and moving the EXCELLENT boundary from 80 to 81. No
  fixture happens to score exactly 80, which confirms the band limitation above.
- **Not covered (future work):** authentication, rate limiting, caching and upstream call
  de-duplication, retries/back-off, i18n of reasons, performance and load, accessibility of
  reason text, and Open-Meteo's own rate limits.
- **Stub vs WireMock or mockttp:** a ~300-line TS stub gives typed fixtures, runs in-process with
  no Docker or Java, and supports date-relative generation. WireMock would bring a richer
  matching DSL that this suite does not need.
- **The 501 placeholder** exists only to turn `ECONNREFUSED` noise into meaningful red. It is
  bypassed whenever `API_BASE_URL` is set.
- **CI:** typecheck, lint and `--dry-run --strict` must pass. The acceptance step is marked
  `continue-on-error: true` because red is the expected state; remove it once the API exists.

**Open questions for the product owner**

- Should `city=London` really be a 409, or should an exact name match pick the most relevant place?
- Is degrading gracefully when wave data is missing the preferred UX, or should the whole request fail?
- Should reasons be localised, and should units follow the user's locale (°F, mph)?
- Is "today" always included, even late in the evening local time?

---

## Traceability

| Acceptance criterion                                        | Covered by                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Accepts a city or town name                                 | `activity_rankings_contract`: exact city name; `input_validation`: 404 / 409   |
| Partial name returns a list of possible matches             | `location_search`: partial name, ordering, case, Unicode, limit, empty list    |
| Fetches 7-day weather from Open-Meteo                       | `upstream_resilience`: request parameters sent; `live_open_meteo`              |
| Ranks each day for each activity                            | `activity_rankings_contract`: 4 per day, ranks; `activity_ranking_rules` (all) |
| Response has date, activity, suitability measure, reasoning | `activity_rankings_contract`: schema, bands; `reasoning` (all)                 |
| Decision: API contract                                      | This README, `src/contract/schemas.ts`                                         |
| Decision: Open-Meteo dependency                             | Stub, fixtures, `@resilience`, `@live`                                         |

---

## Use of AI

This suite was built with Claude Code as a pair. The AI drafted the scaffold, fixtures, stub,
step definitions and most of this README from a written brief (`CLAUDE.md`), and checked the
real Open-Meteo docs for parameter names and units. The human author wrote the brief, reviewed and
approved the feature files before any automation began, and decided the open contract questions
the AI raised (strict 409 for ambiguous names, graceful degradation when the marine API is down,
the tie-break order) and asked for the reference implementation. The AI also flagged its own departures from the brief (injection input
→ 400 or 404, a band table instead of a boundary outline), and these are documented above.
Everything was run locally: typecheck, lint, strict dry run, the red run, the live drift check,
the green run against the reference implementation, and the mutation check.

---

## Sample red output (expected)

```text
  1) Unusable input is rejected before any weather lookup (no location given) # features\input_validation.feature:18
       Then the request is rejected as invalid with a message about "city"
           Expected HTTP 400 with error code INVALID_REQUEST
           but received HTTP 501.

           Response:
             GET http://localhost:3000/api/v1/activity-rankings
             → 501 application/json; charset=utf-8
             {"error":{"code":"NOT_IMPLEMENTED","message":"The Activity Ranking API has not been implemented yet.", …}}

  …
  78 scenarios (78 failed)
  467 steps (284 passed, 105 skipped, 78 failed)
```

The 78 failures break down as: 45 rankings or search calls expecting 200 that received 501, 30
expected errors (400/404/409/502/504) that received 501, 1 forecast request that never reached
Open-Meteo, and 2 injection-input checks. The 284 passing steps are the `Given` set-up steps
(stub programming, fixtures) and the request steps, which shows the harness itself works.

## Project layout

```
features/                  Gherkin (the specification)
src/contract/              zod schemas: our API contract + Open-Meteo shapes
src/stubs/                 Open-Meteo stub server, fixture loading, forecast builders
src/steps/                 thin step definitions
src/assertions/            response and ranking assertion helpers
src/clients/               typed fetch wrapper for the API
src/support/               World, hooks, config, parameter types, timezone-aware dates
test/fixtures/open-meteo/  geocoding catalogue, forecast and marine profiles
placeholder-sut/           501-everywhere stand-in for the missing API
```
