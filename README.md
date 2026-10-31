# Clearance

Clearance presents three airport recovery options, independent ATC/Pilot/Ground assessments and a map replay for a human to compare before selecting a plan.

The workspace keeps the JFK map in the center, ranked options on the left, and an inspector on the right. The inspector’s Agents, Inputs and Decision log tabs keep all controls on the same page. Each side panel scrolls independently. Smaller screens stack the panels below the map.

![Clearance recovery workspace](previews/clearance-map-centred.jpg)

## Run

Requires Node.js 22+. No package install or network connection is needed after downloading this source bundle.

```sh
node src/server.mjs
```

Open http://127.0.0.1:4173. On this Mac, `start.command` also locates the bundled Codex Node runtime. The server listens on loopback only.

## Live Claude recovery agents

The main recovery website supports three independent Claude clients. Copy the six role settings from `.env.example` into the root `.env` and set each role’s own key and an accessible model ID supporting Claude JSON outputs:

```dotenv
ATC_ANTHROPIC_API_KEY=your-atc-key
ATC_ANTHROPIC_MODEL=your-model-id
PILOT_ANTHROPIC_API_KEY=your-pilot-key
PILOT_ANTHROPIC_MODEL=your-model-id
GROUND_ANTHROPIC_API_KEY=your-ground-key
GROUND_ANTHROPIC_MODEL=your-model-id
```

Restart `npm start`. Open **Inputs → Agent execution** and select **Live Claude agents** (the default when all roles are configured), then **Evaluate three plans**. The Agents panel shows progress; Decision log receives each actual response as it arrives. Final options and map previews retain the existing human selection workflow. With missing configuration, live mode is disabled and local policy mode remains available. Keys stay on the server; the browser and exported audit receive only model names and configuration status. Global legacy provider keys are never substituted for role credentials.

Live agents assess the three existing options with independent prompts and histories; later rounds include previous-round peer messages. Calculated efficiency scores remain code-owned, with a 70/100 acceptance threshold. Claude may object to eligible plans, but cannot override hard findings or change plan hashes. At most three rounds/nine requests run, with a 25-second request limit and 90-second overall limit, without automatic retries. API failure or exhausted negotiation produces a labelled deterministic fallback; missing responses are never invented. Disconnecting aborts the run and leaves no selectable incomplete result. Audits include real assessments, model identities, token usage when supplied, and sanitized failure reasons.

No MCP server is required. Automated tests use mock provider responses and do not spend API credits or establish live model quality.

## Visual agent conversation

Switch **Airfield map → Agent conversation** above the map to see ATC, Pilot and Ground as three participants at a shared planning table. Live evaluation opens this view automatically. Speech panels quote the recorded assessment for the current plan; the plan tabs switch which alternative is discussed. The round selector follows live progress or replays an earlier round, including actual position changes and the peer preferences recorded as received. Failed agents have no invented speech or vote.

Agents review concurrently within each round. The coordinator relays complete previous-round messages into the next live round; this is not direct chat or a transcript of hidden model reasoning. The final outcome shows agreement, deterministic fallback, or human review, followed by the recorded human choice. **What am I testing?** explains the expected behavior inside the view.

## Demonstration

1. Select **Evaluate three plans**. The default historical trigger is B6 906, ORD → JFK, 23 December 2015, source CSV row 340659.
2. Compare **Use a spare gate**, **Resequence departures**, and **Keep the original gate**. The default scenario has three hard-valid options, ranked by acceptance count: 3/3, 2/3, 2/3.
3. Each card shows every agent’s decision, efficiency score and rationale, plus arrival time, assigned gate, additional delay, holding fuel, turnaround readiness and ground overtime.
4. Select **Preview on map**, then **Expand map**. Switch the three map tabs and scrub the replay. Reassignment changes the arrival’s gate route. Holding adds an orbit. Resequencing changes two departure timings. The target aircraft then taxis, turns around and departs onward.
5. Select **Choose plan**. This records a human planning choice separately from the recommendation. A validated alternative may carry preference objections. A hard constraint cannot be overridden. Nothing is physically executed.
6. In **Scenario inputs**, make G7–G9 unavailable. Old options and human choice are cleared. Re-evaluate: after three turns with no unanimity, deterministic fallback recommends the validated resequencing plan. The spare-gate option is blocked.
7. With spare gates unavailable, set assumed arrival fuel to 1,500 kg. No option is hard-valid; selection is disabled and the UI requests human review.
8. **Test timeout fallback** bypasses agent messages. No acceptance count or efficiency assessment is fabricated. Export the JSON audit for source facts, assumptions, comparisons, hashes, agent messages and human selection.

## Historical data and constraints

The complete organizer flight CSV is bundled unchanged at `data/flights.csv`. It contains 358,774 records, all satisfying `WEATHER_DELAY > 15 OR LATE_AIRCRAFT_DELAY > 20`. There are 6,524 non-cancelled, non-diverted arrivals with destination JFK. The UI exposes 100 deterministic examples from this group. It does not claim the examples reconstruct the full airport schedule.

Source: https://jpvccqhcdjfupuquwnwc.supabase.co/storage/v1/object/public/experience-datasets/autonomous-sg-2026/challenge-2-flights.csv

`data/flights-index.json` retains exact original row numbers, source fields, source URL and SHA-256. Example order prefers weather-disrupted flights with moderate departure delay and an ETA near 14:00, then source row order. A source row is the disruption trigger. Baseline scenario ETA is scheduled arrival plus nonnegative departure delay, without adding arrival delay again. This simple estimate is an explicit scenario assumption. Actual historical arrival is displayed separately and is not used to claim a measured improvement.

The unchanged supplied workbook is in `reference/challenge-2-operational-constraints.xlsx`; all four sheets are extracted into `data/operational-constraints.json`. Runtime limits include JFK’s synthetic three active runways, 70 gates, three spare gates, aggregate 60 movements/hour and 35-minute turnaround. Wake timing uses the leader/follower table, including its default pair. Fuel and crew values are parsed from the workbook rules.

Regenerate the compact input files with Python’s standard library:

```sh
python3 src/build-data.py
```

`data/airports.csv` and `data/airlines.csv` retain the original supplied lookup files. Their licenses and organizer material provenance are separate from the application’s MIT source-code license.

## Explicit additional assumptions

The CSV has no current gates, complete airport traffic, aircraft type, onboard fuel or crew report times. The scenario therefore declares these assumptions in the interface and audit:

- One historical arrival is surrounded by six synthetic departures and synthetic background runway demand. Background gate occupancy represents the rest of the airport; the delayed-only dataset cannot reconstruct unaffected flights.
- G1 is occupied until minute 44. G7–G9 are the three initially spare gates. Resequencing two departures releases G1 at minute 34.
- The target uses an assumed narrowbody/Large wake class and 6,000 kg trip fuel. Workbook holding burn is 2,400 kg/hour. The 45-minute spare arrival allowance includes the protected 30-minute final reserve. The 5% trip-fuel contingency is carried separately and protected. Default arrival fuel is 2,100 kg, with 1,500 kg protected and 600 kg discretionary.
- Target crew has worked 690 minutes at decision time and is assumed to operate the onward departure. Ground crew has worked 410 minutes. Turnaround takes at least 35 minutes, followed by six minutes for onward pushback/taxi. Overtime is allowed and costs 1.5 times a normalized wage per minute.
- Three active runway aliases, four minutes of arrival taxi, departure fuel/tug assumptions and gate aliases are simulated. Capacity is enforced over rolling 60-minute windows across modeled background, arrivals and departures.
- Taxi paths, turbulence and passenger connections are not claimed as validated operational constraints. No corresponding data was provided. Geometry is illustrative, not an operational airport chart.

## Independent agents and agreement

In **Local policy agents** mode, the recovery desk uses three separate deterministic agents and makes no LLM calls. **Live Claude agents** mode connects the role-specific clients described above. Each role has its own assessment function and history. Its efficiency opinions are transparent policy calculations, not model confidence, probabilities or measured performance.

Each turn contains exactly one structured message per role covering all three options. Turn one supplies preferences and assessments. The next turn shares peer preferences and confirms the same option hashes. An option has consensus only when all three accept its exact plan and scenario identity. The default completes in two turns (six messages). Runs stop after three turns (nine messages).

Hard validity takes precedence in ranking. Valid options then rank by ACCEPT count, lowest agent score, mean score, arrival delay and stable ID. Preference acceptance requires a score of at least 70/100:

- ATC: max(0, 100 − 2 × arrival delay minutes − 14 × resequenced departures).
- Pilot: max(0, 100 − 4 × holding minutes).
- Ground: max(0, 100 − 26 × gate changes − 2 × overtime minutes).

The weights and threshold are disclosed application choices, not organizer constraints. A hard breach produces VETO regardless of efficiency. A preference objection produces COUNTER while keeping a hard-valid alternative available to the human. Consensus applies to the recommended option, not automatically to every alternative.

After three turns with no consensus, a deterministic fallback minimizes arrival delay + holding fuel / 40 + 4 × gate changes + 3 × resequenced departures + 2 × overtime. It chooses only from validated options. Failure means none of these three strategies yielded a valid option; it is not a proof of global infeasibility or optimality.

## Human choice and audit

Preview and human selection are separate. Choosing a 2/3 alternative records `human_selected_validated_alternative`, with the unresolved preference objections. It never becomes agent consensus by relabeling. The server revalidates the option and verifies a hash bound to the entire scenario and plan. Changed inputs create a new session, clear old reviews/selection and require re-evaluation. Comparisons and choices are retained in an exportable session audit. Sessions are in memory and reset on server restart or page reload.

## Map and existing sandbox

The navy/slate palette and JFK schematic are adapted from the supplied HTML, preserved in `reference/JFK Airfield Agents.html`. ATC is amber, Ground cyan and Pilot violet. Gate aliases are simulated: G1 T8/8, G2 T8/12, G3 T4/B24, G4 T4/B27, G5 T5/9, G6 T7/G7, G7 T4/A5, G8 T5/14, G9 T1/3. Three runways are active in the scenario and the fourth is marked inactive context.

Every option has its own map payload. Switching resets the visualization clock and route/stand state to the selected option. Hard-invalid options are inspectable but cannot be replayed or chosen. A human-chosen option is explicitly marked. Replay does not advance the authoritative planning state or execute movements.

The earlier departure sandbox remains at `/operations.html`. Its optional Claude/Gemini adapters and original demonstration are preserved there, with documentation in `reference/DEPARTURE-SANDBOX.md`. That legacy sandbox uses its original simplified fixture; it is not the updated workbook-compliant recovery workflow. The recovery desk uses its own role-specific Claude adapter; the legacy Claude/Gemini adapters remain separate. No live LLM performance has been claimed or tested without credentials.

## Verification and layout

```sh
node --test test/*.test.mjs
```

Tests cover domain checks, exactly three messages per turn, independent acceptance/ranking, exact fuel/notice boundaries, fallback, blocked selections, scenario-bound hashes, source provenance, HTTP exports, and arrival/taxi/turnaround/onward replay boundaries.

- `src/recovery.mjs`: workbook-backed scenario, three strategies, validator, role agents, ranking, fallback and human-choice validation.
- `src/build-data.py`: reproducible extraction/indexing of original inputs.
- `src/server.mjs`: loopback API and static files.
- `public/recovery.*`: recovery comparison interface.
- `public/jfk-plan.js`, `public/jfk-replay.mjs`: map bridge and tested replay helpers.
- `src/domain.mjs`, `src/agents.mjs`, `src/providers.mjs`: preserved departure sandbox.
- `data/`: unchanged source CSVs and compact derived inputs.
- `reference/`: unchanged supplied HTML/workbook and sandbox documentation.
