# Rosie — Few-Shot Resume Scoring

Rosie uses few-shot learning to score resumes. It generates a structured rubric from a job description, optionally calibrates against top-performer resumes, then scores every applicant against that rubric using Claude — producing tier-ranked results with per-dimension reasoning.

The core idea: instead of keyword matching or embedding similarity, give the model a rubric and examples of what "good" looks like, then let it evaluate each resume the way a trained recruiter would.

**[Live Demo](https://rosie-prototype.vercel.app)**

---

## How Few-Shot Scoring Works

Traditional resume screening is either manual (slow, inconsistent) or automated via keyword/embedding matching (brittle, no reasoning). Few-shot scoring sits between the two:

1. **Rubric generation** — Claude reads a job description + recruiter intake notes and produces a structured scoring rubric: weighted must-haves, nice-to-haves, contextual signals, and hidden preferences (team dynamics, working style, growth expectations)

2. **Calibration** *(optional)* — Upload resumes from known top performers. Rosie extracts recurring patterns (skills, experience profiles, career trajectories) and feeds them to the scoring prompt as few-shot examples — anchoring the model's sense of "what good looks like" for this specific role

3. **Per-candidate scoring** — Claude reads each resume natively (PDF as document blocks, DOCX via text extraction) and scores it against the rubric across 4 weighted dimensions, producing a composite score + natural-language reasoning

4. **Tier ranking** — Candidates are bucketed into actionable tiers (advance, review, borderline, reject) based on score thresholds

The rubric is generated once. Calibration is done once. Then every candidate is scored against the same standard — consistently, with full reasoning.

```
                              ┌─────────────────────────┐
                              │   Job Description +     │
                              │   Recruiter Intake Notes │
                              └────────────┬────────────┘
                                           │
                                           ▼
                              ┌─────────────────────────┐
                              │   RUBRIC GENERATION     │
                              │   Claude → structured   │
                              │   scoring criteria      │
                              │   (must-haves, weights, │
                              │    hidden preferences)  │
                              └────────────┬────────────┘
                                           │
              ┌────────────────────────────┤
              │                            │
              ▼                            ▼
┌──────────────────────┐     ┌─────────────────────────┐
│  FEW-SHOT CALIBRATION│     │   PER-CANDIDATE SCORING │
│  (optional)          │     │                         │
│  Top-performer       │────▶│   Resume (PDF/DOCX)     │
│  resumes → extract   │     │     + Rubric            │
│  ideal patterns      │     │     + Ideal patterns    │
└──────────────────────┘     │     → Claude → scores   │
                             │       + reasoning       │
                             └────────────┬────────────┘
                                          │
                                          ▼
                             ┌─────────────────────────┐
                             │   TIER-RANKED RESULTS   │
                             │   Top · Strong ·        │
                             │   Moderate · Below      │
                             └─────────────────────────┘
```

---

## Scoring Model

Each candidate is scored on 4 dimensions (0-10):

| Dimension | What It Measures |
|-----------|-----------------|
| **Technical** | Skills match against rubric requirements, weighted by importance |
| **Experience** | Depth, relevance, company types, role scope, progression |
| **Alignment** | Fit with hidden preferences from intake — team culture, working style, what the hiring manager actually wants but didn't put in the JD |
| **Growth** | Career trajectory, upward mobility, learning velocity |

The overall score uses a **weighted average** — technical and experience are weighted heavier based on rubric weights. Candidates are bucketed into tiers:

| Tier | Score Range | Action |
|------|------------|--------|
| Top Tier | 9.0 - 10 | Advance to screen |
| Strong | 8.0 - 8.9 | Review individually |
| Moderate | 7.0 - 7.9 | Borderline — review or pass |
| Below Threshold | < 7.0 | Bulk reject |

Each score comes with natural-language reasoning — not just a number, but *why* this candidate scored where they did on each dimension.

### Anti-Bias Design

The scoring prompt explicitly instructs Claude:
> Do NOT penalize for demographics, school prestige, or company brand. Score on demonstrated skills and experience.

The model evaluates what candidates *can do*, not where they went to school or which logo is on their resume.

---

## Architecture

```
rosie-prototype/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── greenhouse/
│   │   │   │   ├── jobs/route.ts        # GET open jobs, POST job description
│   │   │   │   └── candidates/route.ts  # POST fetch candidates + resumes
│   │   │   ├── rubric/
│   │   │   │   └── generate/route.ts    # POST JD → Claude → rubric JSON
│   │   │   └── score/route.ts           # POST resume + rubric → Claude → scores
│   │   ├── globals.css                  # Design system tokens (light/dark)
│   │   ├── layout.tsx                   # Geist font, ThemeProvider
│   │   └── page.tsx                     # 4-step workflow UI
│   ├── components/
│   │   ├── ui/                          # shadcn/ui primitives
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── progress.tsx
│   │   │   ├── input.tsx
│   │   │   ├── textarea.tsx
│   │   │   └── alert.tsx
│   │   ├── StepIndicator.tsx            # 4-step progress nav
│   │   ├── CandidateCard.tsx            # Expandable score + reasoning card
│   │   ├── TierSection.tsx              # Collapsible tier group with bulk actions
│   │   ├── ScoreRing.tsx                # SVG radial score visualization
│   │   ├── ScoringProgress.tsx          # Live scoring progress
│   │   ├── ResultsSummary.tsx           # Stats + tier distribution chart
│   │   ├── RubricDisplay.tsx            # Rubric viewer (must-haves, weights)
│   │   ├── IdealPatternsDisplay.tsx     # Few-shot pattern viewer
│   │   └── TierBadge.tsx                # Color-coded tier label
│   └── lib/
│       ├── greenhouse.ts                # ATS integration (Greenhouse Harvest API v1)
│       ├── anthropic.ts                 # Claude scoring + rubric generation
│       ├── types.ts                     # TypeScript interfaces
│       └── utils.ts                     # cn() helper (clsx + tailwind-merge)
```

### Key Technical Decisions

**Native PDF reading**: Resumes are sent to Claude as [document blocks](https://docs.anthropic.com/en/docs/build-with-claude/pdf-support) (base64 encoded) — no OCR, no text extraction, no information loss. Claude reads the PDF directly. DOCX files fall back to text extraction via [mammoth](https://github.com/mbrn/mammoth.js).

**Rubric as a first-class object**: The rubric isn't a hidden prompt — it's a structured JSON artifact the recruiter can inspect and tune before scoring begins. This makes the scoring process transparent and auditable.

**Sequential scoring with real-time progress**: Candidates are scored one at a time so the UI shows live progress and the user can cancel mid-run. Batch parallelism would be faster but sacrifices the progress UX and makes cancellation messy.

**Few-shot calibration via pattern extraction**: Rather than stuffing full resumes into the scoring prompt, Rosie extracts recurring patterns from top-performer resumes (skills, experience profiles, career shapes) and passes those as structured few-shot examples. This keeps the per-candidate context window focused.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 16](https://nextjs.org/) (App Router, Turbopack) |
| Language | TypeScript |
| AI | [Claude Sonnet 4.5](https://docs.anthropic.com/en/docs/about-claude/models) via Anthropic SDK |
| ATS Integration | [Greenhouse Harvest API v1](https://developers.greenhouse.io/harvest.html) |
| UI | [shadcn/ui](https://ui.shadcn.com/) + [Radix UI](https://www.radix-ui.com/) + [Tailwind CSS v4](https://tailwindcss.com/) |
| Resume Parsing | Native PDF (Claude document blocks) + [mammoth](https://github.com/mbrn/mammoth.js) (DOCX) |
| Theming | [next-themes](https://github.com/pacocoursey/next-themes) (dark default, oklch color space) |

## Getting Started

### Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)
- A [Greenhouse Harvest API key](https://developers.greenhouse.io/harvest.html#authentication) (v1, Basic Auth) — or any ATS that exposes jobs + candidate resumes

### Setup

```bash
git clone https://github.com/sam-vangelos/rosie-prototype.git
cd rosie-prototype
npm install
```

Create `.env.local`:

```env
GREENHOUSE_API_KEY=your_greenhouse_harvest_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Roadmap

- [ ] Ideal resume upload (few-shot calibration with top-performer resumes)
- [ ] ATS writeback (advance/reject candidates via Greenhouse API)
- [ ] Session persistence (save/resume scoring sessions)
- [ ] Batch scoring with configurable concurrency
- [ ] Score comparison view (side-by-side candidate evaluation)
- [ ] ATS-agnostic adapter layer (Lever, Ashby, Workday)

## License

MIT

---

Built by [Sam Vangelos](https://github.com/sam-vangelos) — a recruiter who got tired of reading resumes.
