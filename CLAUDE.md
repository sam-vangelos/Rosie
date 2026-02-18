# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (Turbopack, http://localhost:3000)
npm run build        # Production build
npm run lint         # ESLint (Next.js + TypeScript rules)
```

No test framework is configured yet.

## Environment

Requires `.env.local` with two keys:
- `GREENHOUSE_API_KEY` — Greenhouse Harvest API v1 (Basic Auth)
- `ANTHROPIC_API_KEY` — Anthropic API key

## Architecture

Next.js 16 App Router with a 4-step workflow: **Setup → Calibrate → Score → Results**.

All state lives in `page.tsx` as a single `ScreeningSession` object — no external state management. The workflow is sequential: generate a rubric, optionally calibrate with top-performer resumes, score all candidates, view tier-ranked results.

### Scoring Model (discriminative criteria)

The rubric produces 3-5 **discriminative criteria** — specific signals that separate top 5% candidates from the rest. NOT generic dimensions like "technical skills" or "experience level". Each criterion has a weight (summing to 100) and a scoring guide (high/mid/low descriptions).

**Table stakes** (Python, SQL, etc.) are listed but NOT scored — they have no discriminative value.

**Weighted average** is computed in code (`computeOverallScore` in `anthropic.ts`), not by Claude. This makes scores deterministic and reproducible.

**Calibration** extracts patterns from exemplar resumes, then refines the rubric via `calibrateRubric()`. The calibrated rubric includes a `calibrationSummary` explaining what changed.

### Core libraries (`src/lib/`)

| File | Role |
|------|------|
| `anthropic.ts` | Four Claude calls: `generateRubric`, `extractPatterns`, `calibrateRubric`, `scoreCandidate`. Plus `computeOverallScore` (pure code, no AI). Uses Sonnet 4.5. Includes retry logic and JSON extraction. |
| `greenhouse.ts` | Greenhouse Harvest API v1 client. Paginated fetches, resume download (PDF as base64, DOCX text via mammoth), rate-limit handling. |
| `types.ts` | All TypeScript interfaces: `ScoringRubric` (discriminative criteria + table stakes), `CandidateScores` (per-criterion scores with evidence), `IdealPatterns`, `Candidate`, `ScreeningSession`. |

### API routes (`src/app/api/`)

- `greenhouse/jobs` — GET lists open jobs (filters templates); POST fetches a job's description (strips HTML, falls back to `internal_content`)
- `greenhouse/candidates` — POST fetches candidates in "Application Review" stage with resumes
- `rubric/generate` — POST takes JD + intake notes → Claude → discriminative criteria rubric
- `calibrate` — POST takes uploaded resumes + rubric + JD (FormData) → pattern extraction → rubric calibration → calibrated rubric + patterns
- `score` — POST takes rubric + patterns + candidate → Claude → per-criterion scores with evidence → weighted average computed in code → tier

### Resume handling

PDFs are sent to Claude as native document blocks (base64). DOCX files are text-extracted via mammoth and sent as plain text. The scoring route assigns tiers: Top (9.0+), Strong (8.0-8.9), Moderate (7.0-7.9), Below (<7.0).

### UI components (`src/components/`)

shadcn/ui primitives in `ui/`. Domain components: `CandidateCard` (expandable score card), `TierSection` (collapsible tier group), `ScoreRing` (SVG radial viz), `RubricDisplay`, `IdealPatternsDisplay`, `StepIndicator`, `ResultsSummary`.

## Greenhouse API v1 Gotchas

- `departments` array can contain null entries — always null-check
- `/jobs/{id}/job_post` returns a single object, not an array
- `content` can be null for internal-only postings — use `internal_content` fallback
- Resume attachments are S3 signed URLs (no auth needed to download)
- `is_template` jobs must be filtered out of the job list

## Styling

Tailwind CSS v4 with oklch colors for dark mode. Tier colors are CSS variables in `globals.css` (`--tier-top`, `--tier-strong`, `--tier-moderate`, `--tier-below`). Path alias: `@/*` maps to `./src/*`.
