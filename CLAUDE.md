# CLAUDE.md

Working notes for agents and new contributors. The README is the engineering
overview; this file is the mechanics.

## Commands

```bash
npm run dev          # Dev server on 127.0.0.1:3000 (Turbopack)
npm run build        # Production build
npm run lint         # ESLint (Next.js + TypeScript rules)
npm run migrate      # Apply db/migrations/*.sql against DATABASE_URL
```

Tests use Node's built-in `node:test` via tsx:

```bash
npm test                   # Every scripts/test-*.ts file
npm run test:validation    # Scoring-output validation
npm run test:stabilization # Selection, auth, and stage-config helpers
npm run test:seam          # Golden-fixture equality over serialized requests
```

The five suites named `test-*-db.ts`, plus one database case each in
`test-refresh.ts` and `test-resume-text-sanitization.ts`, need `DATABASE_URL`
and skip cleanly without it, so `npm test` is green on a fresh clone with no
credentials. Two live smoke tests exercise the subprocess runtimes against the
real CLIs and skip without their credentials:
`npx tsx scripts/smoke-claude-provider.ts` and
`npx tsx scripts/smoke-codex-provider.ts`. `scripts/smoke-cache.ts` checks
prompt-cache behaviour against the live API and needs `ANTHROPIC_API_KEY`.
Regenerate the golden fixture with `npx tsx scripts/capture-request-fixtures.ts`
only when a request change is intentional.

## Environment

Copy `env.example` to `.env.local`. Three variables are required —
`GREENHOUSE_API_KEY`, `ANTHROPIC_API_KEY`, `DATABASE_URL` — and every optional
knob is documented in the template. The schema is plain SQL migrations
developed against Postgres 16. For a Cloud SQL instance,
`ROSIE_CLOUDSQL_INSTANCE=project:region:instance ./rosie-restart` starts the
Auth Proxy on 5433 and checks that it answers.

## Architecture

Next.js App Router. All state in Postgres (no ORM); resume bytes in object
storage behind `blob-store.ts`. One request gate, one state machine, one
scoring contract.

### Request gate (`src/proxy.ts`)

Single front door for `/api/*`, `/runs`, and `/runs/*`. It strips spoofable
`x-rosie-auth-*` headers, routes cron paths to shared-secret-or-OIDC machine
auth, verifies the Google IAP assertion (`src/lib/iap.ts`, WebCrypto ES256,
pinned issuer and audience), requires a same-origin signal on mutations, and
fails closed in production when IAP is unconfigured. Under `next dev`,
loopback requests inject an operator identity so local development needs no
credential prompt. Server components never trust proxy headers —
`src/lib/require-viewer.ts` re-derives identity from primary evidence.

### Operator cockpit (`src/app/page.tsx` + `src/components/cockpit/`)

Four steps — Setup, Calibrate, Score, Results. `page.tsx` is the controller:
auth check, data loading, API calls, and the run-polling loop. Cross-step
state lives in one reducer, `src/lib/cockpit-session.ts`, where every
transition (rubric ready, run opened, poll progress, cancel, discard) is a
named action — pure, and unit-tested in `scripts/test-cockpit-session.ts`.
Step components under `src/components/cockpit/` hold only step-local UI
state.

### Screening engine (`src/lib/screening-engine.ts`)

A resumable state machine, not a long-running job. A run advances through
fetch → artifacts → triage → audit → score → finalize under a 360-second
lease with heartbeats and a per-tick time budget; when the budget expires the
tick chains a successor. `src/lib/run-store.ts` owns every SQL statement:
lease claim and release, compare-and-set step transitions keyed on lease
owner plus expected step, and the aggregates the viewer reads. The watchdog
(`/api/cron/watchdog`) expires stale batches, fails runs older than 48 hours,
and nudges stalled runs.

### Scheduled refresh (`src/lib/refresh.ts`)

`/api/cron/refresh` re-screens every open requisition that already has a
completed manual run, cloning that run's rubric. The template is deliberately the
newest completed **manual** run per job (`trigger` on `rosie_runs`, migration
003): if scheduled runs could serve as templates, the first one would become
its own successor's template and a one-off experiment would self-perpetuate.
Mode is forced to `new_or_changed` regardless of the template's mode — a
manual run supplies its rubric, never its candidate filter — so the result
cache makes unchanged candidates free and only new applicants cost anything.
Closed requisitions, jobs with a run already in flight, and non-executable
providers are skipped rather than queued.

### Provider seam (`src/lib/providers/`)

One `ScreeningProvider` contract — triage, score, requestJSON — implemented
three ways: Anthropic API, `claude -p` subprocess, `codex exec` subprocess.
Provider is a per-run property enforced in SQL. Subprocess runtimes get a
constructed minimal environment (PATH, HOME, one scoped credential), fresh
temp dirs, tools off except scoped PDF reading, and a credential-shape
tripwire on output (`subprocess.ts`).

### Prompt contract (`src/lib/prompt-texts.ts`)

Every prompt string and JSON schema, runtime-agnostic. The golden fixture
(`scripts/fixtures/request-params.golden.json`) locks the complete serialized
request parameters for all seven call shapes; `npm run test:seam` fails if a
byte moves.

### Scoring model

The rubric is 3–4 discriminative criteria with weights summing to 100, plus
an unscored table-stakes list. The model emits per-criterion scores with
evidence; the weighted average, clamping, and tier assignment happen in code
(`computeOverallScore` in `anthropic.ts`). Validation
(`scoring-validation.ts`) rejects unknown ids, duplicates, out-of-range
scores, and empty evidence as a retryable error class.

### Calibration (`src/lib/calibration-exemplars.ts`)

The exemplar cascade derives an endorsement floor structurally from the
requisition's own stage ladder (one rung above hiring-manager review, by
priority, never by name), walks the ladder top-down collecting up to five
exemplars, and rewrites the rubric's high-score band in one model pass.
Runs refuse to start ungrounded: either a calibration version exists or the
operator asserts the rubric encodes stated hiring-team criteria.

### Caching and batches

`cache.ts` builds content-addressed keys folding in resume fingerprint,
rubric version, calibration version, model, provider, and input mode.
`anthropic-batch.ts` routes large pools through the Message Batches API with
a two-phase submit (membership pinned in a transaction before the remote
batch exists), polling, expiry after 25 hours, and requeue on cancellation.
Each batch row records the model it was submitted with (migration 004);
ingestion keys cached results from that recorded model, never the currently
configured one.

### Viewer (`src/app/runs/`, `src/components/viewer/`)

Server-rendered run list and detail, scoped to the requisitions Greenhouse
lists the viewer on (`job-access.ts`), widened only for Greenhouse site
admins, failing closed on lookup errors. Out-of-scope runs return 404, not
403.

## Greenhouse API v1 gotchas

- `departments` array can contain null entries — always null-check
- `/jobs/{id}/job_post` returns a single object, not an array
- `content` can be null for internal-only postings — use `internal_content`
- Resume attachments are S3 signed URLs; download through the allowlisted,
  size-capped fetcher in `greenhouse.ts`, never directly
- `is_template` jobs must be filtered out of the job list
- `current_stage` freezes at rejection — a candidate rejected after onsite
  still reads as onsite, which is what makes revealed-preference calibration
  work

## Styling

Tailwind CSS v4 with oklch colors and class-based dark mode. Tier colors are
CSS variables in `globals.css` (`--tier-top`, `--tier-strong`,
`--tier-moderate`, `--tier-below`). Path alias: `@/*` maps to `./src/*`.
