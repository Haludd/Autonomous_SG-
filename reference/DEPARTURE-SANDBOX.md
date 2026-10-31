# Clearance

A working local prototype for Aviation Challenge #2: three independent domain agents negotiate a shared, constraint-checked airport departure-recovery plan.

## Run

Requires Node.js 22 or newer. No package installation or external services are needed for the default mode.

```sh
node src/server.mjs
```

Open **http://127.0.0.1:4173**. On this Mac, double-click `start.command`; it also recognizes the bundled Codex Node runtime. The server binds to loopback only. Set `PORT` in `.env` to change the port. The launcher's displayed default URL assumes port 4173.

## A short demonstration

1. Open the default **Weather bottleneck** scenario at JFK, seed 42. Clearance opens on the **Airfield map**. Use **Expand map** for a focused presentation view.
2. Select **Run negotiation**. ATC proposes early staging. Pilot vetoes excess taxi-fuel consumption and proposes later engine starts. Ground then resolves the resulting gate conflict by towing the departure to a remote stand with engines off.
3. All three agents accept plan v3, for the same state version and plan hash. The deterministic validator passes all modeled checks.
4. Use **Play plan** or scrub the replay slider to inspect the accepted timings. Select an aircraft to see its ATC slot, departure fuel margin and ground plan.
5. Select **Tug 2 offline** on the map or **Tug 2 offline +14 min** in Operations, or enter `Tug 2 unavailable for 14 minutes`. Old acceptances become outdated. Automatic replanning assigns the inbound a compatible remote stand instead of using the unavailable tug.
6. In **Operations**, select **Test timeout fallback** to verify a validated deterministic plan is labelled as fallback, not consensus.
7. In **Scenario lab**, choose **No feasible plan** and run. No plan is committed; the UI shows unresolved constraints and human handoff. The bounded search's failure is not itself a proof of infeasibility.
8. Inspect **Audit trail**, expand an event, and export the complete JSON record.

## What works

- Independent ATC, Pilot and Ground agent objects, prompts, histories, proposal tools and reviews.
- Three bounded negotiation rounds and a 45-second deadline.
- A shared versioned plan with SHA-256-derived identifiers; unanimous acceptance must reference the same plan hash and scenario state.
- Server-sent events for proposals, authoritative checks, reviews, fallback and commitment.
- Deterministic checks for available slots, simplified wake spacing, taxi capacity, readiness, latest departure, departure fuel, gate exclusivity, stand compatibility and equipment conflicts/outages.
- Updated scenarios invalidate earlier acceptances, including updates made while provider calls are in progress.
- A deterministic fallback and a bounded search reference using the same inputs and validator.
- Weather, equipment outage, tight fuel allowance and unresolved gate scenarios.
- Typed disruption updates, with a deliberately limited offline text parser.
- Flight CSV subset import with the exact filter `WEATHER_DELAY > 15 OR LATE_AIRCRAFT_DELAY > 20`.
- Source-code MIT license; bundled user-supplied data has separate provenance/licensing.

## JFK map and visual theme

The map geometry and dark navy/slate palette come from the user-supplied **JFK Airfield Agents.html**. Its unchanged source is preserved in `reference/`. The application uses amber for ATC, cyan for Ground, violet for Pilot, green for accepted checks and red for conflicts throughout Operations, Scenario lab, Evaluation, Audit trail and dialogs.

**Clearance plan** connects the schematic to the actual scenario, selected schedule, agent reviews and versioned state. Drafts remain parked. Replay is enabled only after consensus or a validated fallback for the current state. A disruption invalidates the previous result and resets the replay. The slider advances a visualization clock only; it never executes movements or changes planning time.

The original file's independent random-traffic simulation remains available as **Original demo**, with its original Tower/Ground/Sentinel controllers. Those controllers are local heuristics, independent of Clearance's ATC/Pilot/Ground negotiation. No external fonts or network requests are required by either map.

Stand aliases are simulated: G1 → T8/8, G2 → T8/12, G3 → T4/B24, G4 → T4/B27, G5 → T5/9, G6 → T7/G7. R1 is an added illustrative remote apron. Incoming flights depict fixed gate demand rather than an arrival flight-control simulation. All departures use a 4L illustration of the model's pooled slot stream; the other runways provide visual context. Taxi paths, separation on the drawn graph and individual runway allocation are not validated operational constraints. The map is a schematic, not an airport chart or live tracker.

The preserved reference HTML and its adapted geometry are user-supplied material; the repository's MIT license does not grant rights to that source. Confirm its reuse terms before public distribution.

## Policy mode versus live LLM mode

**The default is local policy-agent mode. It makes no LLM calls.** Its agents make role-specific deterministic decisions; the UI and audit identify this mode. It is useful for development and a reliable local demonstration, but it is not evidence of LLM performance.

Optional Claude and Gemini REST adapters are included. Copy `.env.example` to `.env`, then configure a provider key and a model ID supported by your own account:

```dotenv
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=...
GEMINI_API_KEY=...
GEMINI_MODEL=...
```

Restart the server. Use the gear button to select Claude, Gemini, or mixed mode (ATC/Ground: Claude; Pilot: Gemini). Three separate agent instances make independent proposal/review requests. Models submit typed decisions; deterministic tools construct plans and independently check every hard limit. An LLM acceptance cannot override a failed check.

Keys remain on the server. They are not sent to the browser or exported in audit records. `.env` is git-ignored. Live requests transmit scenario data and the relevant agent history to the selected provider. Provider failures are recorded and trigger explicitly labelled fallback.

**Live API integration is not end-to-end verified without credentials.** Response validation, provider failure behaviour and authoritative veto protection are tested with injected transports. The offline text-update parser recognizes only the documented patterns below; arbitrary natural-language understanding is not implemented.

Provider references:

- [Claude Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)

## Disruption inputs

Text forms supported offline:

- `Tug 2 unavailable for 14 minutes`
- `Tug 1 offline for 10 minutes`
- `No departures for 26 minutes`
- `Close R1`

Unknown or ambiguous text does not change the state. The API also supports structured `resource_outage`, `capacity`, `fuel`, and `stand_closed` updates. Fuel updates use a known flight ID and a modeled maximum engine-on allowance. Updates operate from simulation time zero; no aircraft movements are actually executed.

## Data provenance

`data/airports.csv` and `data/airlines.csv` are unchanged copies of the supplied reference files. They identify 322 airports and 14 airlines. Coordinates are not used for scheduling, suitability, fuel calculations or operational routing.

**No historical flight-level dataset was supplied.** The initial flights, gates, operating windows, equipment, wake categories, fuel quantities and burn rates are synthetic. They are illustrative model assumptions, not operational minima or real fuel predictions.

Scenario lab accepts flight-record CSV subsets up to 2 MB. It displays up to the first 100 qualifying records, preserving unknown delay values as unknown. Selecting a row changes the historical trigger identity and source provenance; it does not infer a capacity restriction or operational state from recorded delay minutes. All remaining timings and resources stay simulated. The simulator clock is illustrative, not a reconstruction of that record's actual operation.

## Evaluation

The Evaluation view compares the current committed outcome, the deterministic fallback and a bounded reference search. Fallback results are explicitly distinguished from agent consensus. Local-policy evaluation is not an LLM evaluation.

The objective is an explicit weighted combination of total departure delay, engine-on time, tow movements, inbound remote-stand assignments, ground overtime and worst-flight delay. Weights live in the scenario object. The score is not dollars or a measured business saving.

The reference enumerates up to 720 departure orders and applies earliest-slot scheduling and local stand/tug repair. It **does not prove global optimality**, because it does not exhaust every combination of movement times, stand choices and resource placements. The simulator and planning horizon are intentionally small. An unresolved outcome means no validated plan was found by these bounded methods.

Run the reproducible local-policy benchmark:

```sh
node src/benchmark.mjs
```

No scheduling superiority is presumed. The default scenario currently matches the capable deterministic baseline. The product's demonstrable contribution is independent constraint communication, auditable agreement and state-update handling.

Operational context: [FAA surface metering](https://www.faa.gov/air_traffic/technology/tfdm/sm). This prototype does not replace operational ATC systems or certify aviation safety; checks apply only to the modeled constraints.

## Tests

```sh
node --test test/*.test.mjs
```

The suite covers complete negotiations, role-specific fuel/gate vetoes, state changes before commit, consensus hash/version checks, unresolved cases, round-limit/timeout fallback, fuel-boundary equality, equipment conflicts, malformed provider outputs, CSV exact thresholds and quoted fields, HTTP streaming, audit exports, import provenance and cross-origin mutation rejection, map embedding restrictions, replay phase boundaries, departure fuel clamping and gate-occupancy parity with the validator. HTTP tests use a temporary loopback port.

## Layout

```text
src/domain.mjs     Scenario model, authoritative validator, scheduling tools, fallback, search
src/agents.mjs     Three independent domain agents and bounded coordinator
src/providers.mjs  Optional Claude and Gemini structured-response adapters
src/import.mjs     CSV parsing and qualifying-flight filtering
src/server.mjs     Local HTTP API, sessions, SSE and audit export
src/benchmark.mjs  Reproducible local-policy benchmark
public/           Dependency-free browser interface
test/             Domain, map replay and HTTP tests
reference/        Unchanged user-supplied JFK HTML
data/             Original supplied airport/airline reference tables
```

Sessions are in memory and are reset when the server restarts. Reloading the page starts a new scenario session; export an audit before reloading if you want to keep it. Each export retains the scenario snapshot for every run, so old results are not falsely associated with updated inputs.

## Next implementation priorities

1. Configure live provider credentials and validate real API responses, latency, cost and convergence.
2. Load the actual flight dataset and select a documented qualifying historical trigger.
3. Add broader text-update extraction with schema validation and explicit ambiguity handling.
4. Add persistent run storage and richer evaluation over varied disruptions.
5. Add an exact optimization reference if time permits; report solver bounds/status honestly.
