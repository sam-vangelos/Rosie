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

### Core libraries (`src/lib/`)

| File | Role |
|------|------|
| `anthropic.ts` | Three Claude calls: `generateRubric`, `extractPatterns`, `scoreCandidate`. Uses Sonnet 4.5. Includes retry logic (3 attempts, exponential backoff) and a JSON extraction helper that handles markdown fences. |
| `greenhouse.ts` | Greenhouse Harvest API v1 client. Paginated fetches, resume download (PDF as base64, DOCX text via mammoth), rate-limit handling. |
| `types.ts` | All TypeScript interfaces: `ScoringRubric`, `IdealPatterns`, `Candidate`, `ScreeningSession`. |

### API routes (`src/app/api/`)

- `greenhouse/jobs` — GET lists open jobs (filters templates); POST fetches a job's description (strips HTML, falls back to `internal_content`)
- `greenhouse/candidates` — POST fetches candidates in "Application Review" stage with resumes
- `rubric/generate` — POST takes JD + intake notes → Claude → structured rubric JSON
- `calibrate` — POST takes uploaded resumes (FormData) → local text extraction → Claude → ideal patterns
- `score` — POST takes rubric + patterns + candidate → Claude → scores + reasoning + tier

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
