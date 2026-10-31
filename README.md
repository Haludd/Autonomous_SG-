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

## Live recovery agents and conversation

The recovery desk supports three separate Claude clients for ATC, Pilot and Ground, alongside local policy mode. Each client has its own role prompt, credential setting and history. Put the six settings from `.env.example` in the root `.env`, using keys and model IDs available to your Anthropic account:

```dotenv
ATC_ANTHROPIC_API_KEY=your-atc-key
ATC_ANTHROPIC_MODEL=your-model-id
PILOT_ANTHROPIC_API_KEY=your-pilot-key
PILOT_ANTHROPIC_MODEL=your-model-id
GROUND_ANTHROPIC_API_KEY=your-ground-key
GROUND_ANTHROPIC_MODEL=your-model-id
```

The configured model must support [Claude JSON outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Restart the server after editing `.env`. In **Inputs → Agent execution**, select **Live Claude agents**, then **Evaluate three plans**. Live mode is the initial default when all three roles are configured; otherwise it is disabled and local policy mode is available. Opening the conversation view makes no API calls. Keys remain server-side, and legacy global provider keys are not substituted for role credentials.

Use **Agent conversation** on the map to open a floating discussion panel. The geographic map remains behind it, with the existing side-panel toggles, logo, colours and gate anchors preserved. Live runs open the discussion automatically. The three speakers show actual returned assessments for the selected plan. The plan tabs change the option being discussed, and **Discussion round** replays previous rounds or follows new responses. **What this agent heard** shows previous-round preferences and, for live agents, the exact received assessment text. Enforced decisions are explained when an agent’s proposed decision conflicts with a hard check or score threshold. Decision log also receives each real message as it arrives.

The first round reviews the same three plans independently. Each later round receives the other roles’ complete previous-round messages, plus its own history. The coordinator relays recorded messages; the conversation presents returned assessments rather than hidden model reasoning. Agents receive the selected airport’s operational scenario, historical trigger, candidate plans, authoritative domain checks and collision impacts. Geographic gate-node payloads are omitted from API prompts. Airport-specific chains remain part of ranking and fallback, and a stranded chained arrival prevents unanimous consensus in either execution mode.

Live reviews have a three-round/nine-request limit, a 25-second per-request timeout and a 90-second overall timeout, without automatic retries. Hard checks, calculated efficiency scores, plan hashes and human-choice validation remain code-owned. Provider failures retain real partial responses and produce a labelled deterministic fallback; missing speech or acceptance is never invented. Disconnecting aborts the run and leaves no selectable incomplete result. The audit retains actual assessments, received peer messages, model identities, supplied token usage, collision impacts and sanitized failures. Automated tests mock the provider; passing them does not establish live model quality or provider-account access.

## Demonstration

1. Select **Evaluate three plans**. The default historical trigger is B6 906, ORD → JFK, 23 December 2015, source CSV row 340659.
2. Compare **Use a spare gate**, **Resequence departures**, and **Keep the original gate**. The default scenario has three hard-valid options, ranked by acceptance count: 3/3, 2/3, 2/3.
3. Each card shows every agent’s decision, efficiency score and rationale, plus arrival time, assigned gate, additional delay, holding fuel, turnaround readiness and ground overtime.
4. Select **Preview on map**, then **Map only**. Switch the three map tabs and scrub the replay. Reassignment changes the arrival’s simulated stand route. Holding adds an orbit. Resequencing changes two departure timings. The target aircraft then taxis, turns around and departs onward.
5. Select **Choose plan**. This records a human planning choice separately from the recommendation. A validated alternative may carry preference objections. A hard constraint cannot be overridden. Nothing is physically executed.
6. In **Scenario inputs**, make G7–G9 unavailable. Old options and human choice are cleared. Re-evaluate: after three turns with no unanimity, deterministic fallback recommends the validated resequencing plan. The spare-gate option is blocked.
7. With spare gates unavailable, set assumed arrival fuel to 1,500 kg. No option is hard-valid; selection is disabled and the UI requests human review.
8. **Test timeout fallback** bypasses agent messages. No acceptance count or efficiency assessment is fabricated. Export the JSON audit for source facts, assumptions, comparisons, hashes, agent messages and human selection.
9. Open **Inputs**, enable **Stress test: overlap up to three other arrivals**, then evaluate again. The **Chain collisions** widget below the option cards shows priority tiers, serving order and knock-on effects for the current preview. Changing airports resets the stress test. For a naturally overlapping JFK example, select B6 717 in the historical-flight picker.

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
- In the default JFK example, G1 is occupied until minute 44. G7–G9 are spare. Airports with two workbook spares use G7–G8. Resequencing two departures releases G1 at minute 34. Gate aliases and assignments are simulated; available map anchors use source gate coordinates.
- The target uses an assumed narrowbody/Large wake class and 6,000 kg trip fuel. Workbook holding burn is 2,400 kg/hour. The 45-minute spare arrival allowance includes the protected 30-minute final reserve. The 5% trip-fuel contingency is carried separately and protected. Default arrival fuel is 2,100 kg, with 1,500 kg protected and 600 kg discretionary.
- Target crew has worked 690 minutes at decision time and is assumed to operate the onward departure. Ground crew has worked 410 minutes. Turnaround takes the airport’s workbook minimum (35 or 45 minutes), followed by six minutes for onward pushback/taxi. Overtime is allowed and costs 1.5 times a normalized wage per minute.
- Active runway allocation, background traffic, four minutes of arrival taxi, departure fuel/tug assumptions and gate aliases are simulated. Capacity is enforced over rolling 60-minute windows across modeled background, arrivals and departures.
- Taxi paths, turbulence and passenger connections are not claimed as validated operational constraints. No corresponding data was provided. Geometry is illustrative, not an operational airport chart.

## Independent agents and agreement

In **Local policy agents** mode, the recovery desk uses three separate deterministic agents and makes no LLM calls. **Live Claude agents** mode uses the role-specific clients described above. Each role has its own assessment function and history. Efficiency scores remain transparent policy calculations, not model confidence, probabilities or measured performance.

Each turn contains exactly one structured message per role covering all three options. Turn one supplies preferences and assessments. The next turn shares peer preferences and confirms the same option hashes. An option has consensus only when all three accept its exact plan and scenario identity. The default completes in two turns (six messages). Runs stop after three turns (nine messages).

Hard validity takes precedence in ranking. Valid options then rank by fewer stranded chained arrivals, ACCEPT count, lowest agent score, mean score, knock-on cost to other chained arrivals, arrival delay and stable ID. Preference acceptance requires a score of at least 70/100:

- ATC: max(0, 100 − 2 × arrival delay minutes − 14 × resequenced departures).
- Pilot: max(0, 100 − 4 × holding minutes).
- Ground: max(0, 100 − 26 × gate changes − 2 × overtime minutes).

The weights and threshold are disclosed application choices, not organizer constraints. A hard breach produces VETO regardless of efficiency. A preference objection produces COUNTER while keeping a hard-valid alternative available to the human. Consensus applies to the recommended option, not automatically to every alternative.

After three turns with no consensus, a deterministic fallback minimizes arrival delay + holding fuel / 40 + 4 × gate changes + 3 × resequenced departures + 2 × overtime + knock-on cost to other chained arrivals. It chooses only from validated options. Failure means none of these three strategies yielded a valid option; it is not a proof of global infeasibility or optimality.

## Chain collisions and triage

Each recovery evaluation screens competing claims on spare gates, arrival slots and onward departures among the selected airport’s indexed historical arrivals. Chains follow overlapping claim windows transitively, rather than placing flights in fixed hour buckets. Airport selection scopes the candidate pool, capacity, turnaround rules and same-tail onward links. The default JFK flight has no natural chain; B6 717 and B6 584 share one.

The urgency policy uses five ordered tiers: exhausted discretionary fuel, urgent fuel, urgent crew margin, spare-gate need and routine. Fuel and crew margins are scenario assumptions, not measured historical aircraft facts. Within each tier, least slack and then earliest ETA decide urgency. The search compares tier-preserving serving orders for up to six flights. Each flight takes its cheapest available option given prior claims; total cost includes slipped slots and delay passed to an indexed same-tail onward departure. Larger chains disclose the full count and that only six flights were searched.

Per-option cards and the inspector show serving position and knock-on cost. The Chain collisions widget expands the priority list, serving order, effects and disclosed policy. A stranded chained arrival prevents unanimous consensus and affects ranking. Chain results are a system check alongside the three agents. Human selection and JSON exports retain the selected option’s chain impact, and plan identity includes the session’s stress setting and chain source rows.

The optional stress test re-times up to three other historical arrivals from the same airport to 1–3 minutes after the selected flight. The collision is synthetic. Fuel, crew and occupancy remain simulated. It does not modify the geographic map, source gate anchors, panel controls or selected airport.

The chain screen pools spare gates and uses one-minute arrival and onward slot bins. These are disclosed contention heuristics; they do not form a joint wake-validated operational schedule. The normal per-option hard checks still apply. Only indexed delayed arrivals participate, so a chain-free result does not describe all airport traffic. `data/onward-index.json` traces the earliest later same-tail departure at each arrival airport on the same date; links are partial because the CSV omits unaffected flights. Re-run `python3 src/build-data.py` after rebuilding the airport catalog to refresh these links for all indexed examples.

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

The earlier departure sandbox remains at `/operations.html`. Its optional Claude/Gemini adapters and original demonstration are preserved there, with documentation in `reference/DEPARTURE-SANDBOX.md`. That legacy sandbox uses its original simplified fixture; it is not the updated workbook-compliant recovery workflow. The recovery desk has its own role-specific Claude adapter. No live LLM performance has been claimed or tested without credentials.

## Verification and layout

```sh
node --test test/*.test.mjs
```

Tests cover domain checks, exactly three messages per turn, independent acceptance/ranking, fuel/notice boundaries, fallback, blocked selections, scenario-bound hashes, source provenance, HTTP exports, and replay boundaries. Airport tests cover all 322 coordinate records, all 9,075 historical examples, recommendations for every airport with eligible arrivals, small-airport limits, absent arrival seeds, cross-airport plan invalidation, geographic projection and runway identifier normalization.

- `src/recovery.mjs`: workbook-backed scenario, three strategies, validator, role agents, ranking, fallback and human-choice validation.
- `src/live-recovery.mjs`: independent Claude reviews, peer-message relay, bounded requests and authoritative decision enforcement.
- `public/agent-conversation.mjs`, `public/live-recovery.css`: recorded conversation rendering and additive discussion-panel styling.
- `src/chain.mjs`, `src/triage.mjs`: airport-scoped chain screening, serving order and urgency tiers.
- `public/collision-triage.css`: additive collision-widget styles; the existing map and panel stylesheet is preserved.
- `data/onward-index.json`: traceable partial onward-flight links for indexed arrivals.
- `src/build-data.py`: reproducible extraction/indexing of original inputs.
- `src/build-airport-catalog.py`, `src/build-gate-catalog.py`, `src/airports.mjs`: geographic catalogs and airport data access.
- `src/server.mjs`: loopback API and static files.
- `public/recovery.*`: recovery comparison interface.
- `public/airport-map.*`, `public/airport-geometry.mjs`: geographic map and simulated replay overlay.
- `public/jfk-plan.js`, `public/jfk-replay.mjs`: map bridge and tested replay helpers.
- `src/domain.mjs`, `src/agents.mjs`, `src/providers.mjs`: preserved departure sandbox.
- `data/`: unchanged source CSVs and compact derived inputs.
- `reference/`: unchanged supplied HTML/workbook and sandbox documentation.
