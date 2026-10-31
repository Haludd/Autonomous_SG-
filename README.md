# Clearance

Clearance presents three airport recovery options, independent ATC/Pilot/Ground assessments and a map replay for a human to compare before selecting a plan.

The selected airport’s geographic map fills the viewport. The **Airport map** selector in the top bar covers all **322 airports** in the organizer CSV. Changing the airport updates its map, historical arrival examples and workbook planning limits. Recovery options and the plan inspector float above it as rounded, independently scrollable panels. Their title-bar arrows hide each panel; the edge handles reopen them. The floating bottom dock opens Options, Inputs, Agents and the Decision log. **Map only** hides both panels, and **Show panels** restores the previous arrangement; the keyboard shortcut is **M**. Panel toggles preserve the selected plan, map position and replay clock. Smaller screens show one panel at a time.

Maps use [OpenStreetMap](https://www.openstreetmap.org/copyright), [OurAirports runway endpoints](https://ourairports.com/data/) and a locally bundled [Leaflet 1.9.4](https://leafletjs.com/) viewer. The navy/slate palette and amber/cyan/violet role colours are preserved.

## Run

Requires Node.js 22+. No package install is required. Street-map tiles require an internet connection; **Runway outline** uses the bundled runway geometry and remains available without street tiles.

```sh
node src/server.mjs
```

Open http://127.0.0.1:4173. On this Mac, `start.command` also locates the bundled Codex Node runtime. The server listens on loopback only.

## Demonstration

1. Select **Evaluate three plans**. The default historical trigger is B6 906, ORD → JFK, 23 December 2015, source CSV row 340659.
2. Compare **Use a spare gate**, **Resequence departures**, and **Keep the original gate**. The default scenario has three hard-valid options, ranked by acceptance count: 3/3, 2/3, 2/3.
3. Each card shows every agent’s decision, efficiency score and rationale, plus arrival time, assigned gate, additional delay, holding fuel, turnaround readiness and ground overtime.
4. Select **Preview on map**, then **Map only**. Switch the three map tabs and scrub the replay. Reassignment changes the arrival’s simulated stand route. Holding adds an orbit. Resequencing changes two departure timings. The target aircraft then taxis, turns around and departs onward.
5. Select **Choose plan**. This records a human planning choice separately from the recommendation. A validated alternative may carry preference objections. A hard constraint cannot be overridden. Nothing is physically executed.
6. In **Scenario inputs**, make G7–G9 unavailable. Old options and human choice are cleared. Re-evaluate: after three turns with no unanimity, deterministic fallback recommends the validated resequencing plan. The spare-gate option is blocked.
7. With spare gates unavailable, set assumed arrival fuel to 1,500 kg. No option is hard-valid; selection is disabled and the UI requests human review.
8. **Test timeout fallback** bypasses agent messages. No acceptance count or efficiency assessment is fabricated. Export the JSON audit for source facts, assumptions, comparisons, hashes, agent messages and human selection.

## Historical data and constraints

The complete organizer flight CSV is bundled unchanged at `data/flights.csv`. It contains 358,774 records, all satisfying `WEATHER_DELAY > 15 OR LATE_AIRCRAFT_DELAY > 20`. The airport catalog exposes **9,075 deterministic examples**: up to 30 per airport, with the original 100 retained for JFK. There are 6,524 eligible JFK arrivals. Pago Pago (PPG) and Vernal (VEL) occur in the CSV but have no qualifying non-cancelled, non-diverted arrival record; their maps can be browsed, while recovery evaluation is disabled. The examples do not reconstruct the full airport schedule.

Source: https://jpvccqhcdjfupuquwnwc.supabase.co/storage/v1/object/public/experience-datasets/autonomous-sg-2026/challenge-2-flights.csv

`data/flights-index.json` retains exact original row numbers, source fields, source URL and SHA-256. Example order prefers weather-disrupted flights with moderate departure delay and an ETA near 14:00, then source row order. A source row is the disruption trigger. Baseline scenario ETA is scheduled arrival plus nonnegative departure delay, without adding arrival delay again. This simple estimate is an explicit scenario assumption. Actual historical arrival is displayed separately and is not used to claim a measured improvement.

The unchanged supplied workbook is in `reference/challenge-2-operational-constraints.xlsx`; all four sheets are extracted into `data/operational-constraints.json`. Each airport uses its own workbook row. For example, JFK uses three active runways, 70 gates, three spares and 60 movements/hour, whereas Aberdeen (ABR) uses one runway, eight gates, two spares and 20 movements/hour. These remain organizer-supplied synthetic limits. Wake timing uses the leader/follower table, including its default pair. Fuel and crew values are parsed from the workbook rules.

Regenerate the compact input files with Python’s standard library:

```sh
python3 src/build-data.py
```

`data/airports.csv` and `data/airlines.csv` retain the original supplied lookup files. Their licenses and organizer material provenance are separate from the application’s MIT source-code license.

## Explicit additional assumptions

The CSV has no current gates, complete airport traffic, aircraft type, onboard fuel or crew report times. The scenario therefore declares these assumptions in the interface and audit:

- One historical arrival is surrounded by six synthetic departures and synthetic background runway demand. Background gate occupancy represents the rest of the airport; the delayed-only dataset cannot reconstruct unaffected flights.
- In the default JFK example, G1 is occupied until minute 44. G7–G9 are spare. Airports with two workbook spares use G7–G8. Resequencing two departures releases G1 at minute 34. Gate aliases and their map positions are simulated.
- The target uses an assumed narrowbody/Large wake class and 6,000 kg trip fuel. Workbook holding burn is 2,400 kg/hour. The 45-minute spare arrival allowance includes the protected 30-minute final reserve. The 5% trip-fuel contingency is carried separately and protected. Default arrival fuel is 2,100 kg, with 1,500 kg protected and 600 kg discretionary.
- Target crew has worked 690 minutes at decision time and is assumed to operate the onward departure. Ground crew has worked 410 minutes. Turnaround takes the airport’s workbook minimum (35 or 45 minutes), followed by six minutes for onward pushback/taxi. Overtime is allowed and costs 1.5 times a normalized wage per minute.
- Active runway allocation, background traffic, four minutes of arrival taxi, departure fuel/tug assumptions and gate aliases are simulated. Capacity is enforced over rolling 60-minute windows across modeled background, arrivals and departures.
- Taxi paths, turbulence and passenger connections are not claimed as validated operational constraints. No corresponding data was provided. Geometry is illustrative, not an operational airport chart.

## Independent agents and agreement

The recovery desk currently uses **three separate local policy agents; it makes no LLM calls**. Each role has its own assessment function and history. Its efficiency opinions are transparent policy calculations, not model confidence, probabilities or measured performance.

Each turn contains exactly one structured message per role covering all three options. Turn one supplies preferences and assessments. The next turn shares peer preferences and confirms the same option hashes. An option has consensus only when all three accept its exact plan and scenario identity. The default completes in two turns (six messages). Runs stop after three turns (nine messages).

Hard validity takes precedence in ranking. Valid options then rank by ACCEPT count, lowest agent score, mean score, arrival delay and stable ID. Preference acceptance requires a score of at least 70/100:

- ATC: max(0, 100 − 2 × arrival delay minutes − 14 × resequenced departures).
- Pilot: max(0, 100 − 4 × holding minutes).
- Ground: max(0, 100 − 26 × gate changes − 2 × overtime minutes).

The weights and threshold are disclosed application choices, not organizer constraints. A hard breach produces VETO regardless of efficiency. A preference objection produces COUNTER while keeping a hard-valid alternative available to the human. Consensus applies to the recommended option, not automatically to every alternative.

After three turns with no consensus, a deterministic fallback minimizes arrival delay + holding fuel / 40 + 4 × gate changes + 3 × resequenced departures + 2 × overtime. It chooses only from validated options. Failure means none of these three strategies yielded a valid option; it is not a proof of global infeasibility or optimality.

## Human choice and audit

Preview and human selection are separate. Choosing a 2/3 alternative records `human_selected_validated_alternative`, with the unresolved preference objections. It never becomes agent consensus by relabeling. The server revalidates the option and verifies a hash bound to the entire scenario and plan. Changed inputs create a new session, clear old reviews/selection and require re-evaluation. Comparisons and choices are retained in an exportable session audit. Sessions are in memory and reset on server restart or page reload.

## Airport maps, sources and existing sandbox

All 322 airports have geographic locations. **320 have runway endpoint geometry** in the downloaded OurAirports snapshot. ECP and the historical ISN location lack runway endpoints in that source; their airport locations and online street-map context still work, and the UI discloses the missing outlines. Current map context does not reconstruct the airport as it existed in 2015. Existing airport names and coordinates from the organizer remain provenance; three missing coordinates are supplied by OurAirports.

OpenStreetMap supplies street-map tiles, with visible attribution. The app requests only the map a user is viewing, honours normal browser caching and does not bulk-download or prefetch tiles. See the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/). Airport and runway CSVs from [OurAirports](https://ourairports.com/data/) are public domain. `data/airport-catalog.json` records source URLs, retrieval time and source SHA-256 hashes. Leaflet is vendored under its included BSD-2-Clause license at `public/vendor/leaflet/LICENSE`.

Real runway outlines and mapped passenger gates are displayed over the map. `data/airport-gates.json` contains **5,851 OpenStreetMap gate points across 222 of the 322 airports**, with original latitude/longitude, gate references, OSM node links, snapshot time and source hashes. The data is attributed to OpenStreetMap contributors under ODbL 1.0. Each node is associated with the nearest organizer airport reference point within 5 km; this association is derived. These [passenger gate points](https://wiki.openstreetmap.org/wiki/Tag:aeroway=gate) do not specify aircraft parking positions or live gate availability.

Scenario aliases G1–G9 (G1–G8 at smaller airports) bind to distinct source nodes in stable gate-reference order. Markers use source coordinates and references, and replay uses the same anchors. Flight assignments and occupancy remain simulated; aliases are not literal airport gate numbers. Zoom in for gate labels, or click a point to inspect its source. Airports with no mapped gates, or too few mapped gates for the scenario, omit the missing markers and dependent ground movements. No coordinates are guessed. Dashed replay taxi paths remain illustrative connectors, not validated taxiway routes. Missing source runway endpoints also suppress dependent replay segments. Street-tile failure leaves local runways and gate points visible. PPG and VEL have maps but no eligible arrival seed.

To reproduce the airport catalog, download `airports.csv` and `runways.csv` from the [OurAirports data page](https://ourairports.com/data/) into a separate directory, then run:

```sh
python3 src/build-airport-catalog.py /path/to/ourairports-downloads
```

To reproduce the gate catalog, submit `data/map-sources/gates-query.overpassql` to the [Overpass API](https://overpass-api.de/), save the JSON response, then run:

```sh
python3 src/build-gate-catalog.py /path/to/gates.json
```

This is a build-time extraction, not a query on every airport switch. The committed snapshot works locally without an Overpass connection.

The old JFK schematic remains in the departure sandbox. Its original source HTML is preserved in `reference/JFK Airfield Agents.html`. ATC is amber, Ground cyan and Pilot violet throughout the application.

Every option has its own map payload. Switching resets the visualization clock and route/stand state to the selected option. Hard-invalid options are inspectable but cannot be replayed or chosen. A human-chosen option is explicitly marked. Replay does not advance the authoritative planning state or execute movements.

The earlier departure sandbox remains at `/operations.html`. Its optional Claude/Gemini adapters and original demonstration are preserved there, with documentation in `reference/DEPARTURE-SANDBOX.md`. That legacy sandbox uses its original simplified fixture; it is not the updated workbook-compliant recovery workflow. Live-provider adapters are not connected to the new three-option recovery desk. No live LLM performance has been claimed or tested without credentials.

## Verification and layout

```sh
node --test test/*.test.mjs
```

Tests cover domain checks, exactly three messages per turn, independent acceptance/ranking, fuel/notice boundaries, fallback, blocked selections, scenario-bound hashes, source provenance, HTTP exports, and replay boundaries. Airport tests cover all 322 coordinate records, all 9,075 historical examples, recommendations for every airport with eligible arrivals, small-airport limits, absent arrival seeds, cross-airport plan invalidation, geographic projection and runway identifier normalization.

- `src/recovery.mjs`: workbook-backed scenario, three strategies, validator, role agents, ranking, fallback and human-choice validation.
- `src/build-data.py`: reproducible extraction/indexing of original inputs.
- `src/build-airport-catalog.py`, `src/build-gate-catalog.py`, `src/airports.mjs`: geographic catalogs and airport data access.
- `src/server.mjs`: loopback API and static files.
- `public/recovery.*`: recovery comparison interface.
- `public/airport-map.*`, `public/airport-geometry.mjs`: geographic map and simulated replay overlay.
- `public/jfk-plan.js`, `public/jfk-replay.mjs`: map bridge and tested replay helpers.
- `src/domain.mjs`, `src/agents.mjs`, `src/providers.mjs`: preserved departure sandbox.
- `data/`: unchanged source CSVs and compact derived inputs.
- `reference/`: unchanged supplied HTML/workbook and sandbox documentation.
