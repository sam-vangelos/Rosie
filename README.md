# Rosie — AI Resume Screening for Greenhouse

Rosie extracts applicants from [Greenhouse](https://www.greenhouse.com/), scores their resumes against AI-generated rubrics using Claude, and stack-ranks them into actionable tiers — turning a 4-hour manual screen into a 5-minute workflow.

Built for recruiters who spend too much time reading resumes and not enough time talking to candidates.

---

## The Problem

A typical recruiter screens 100-200 resumes per open role. Each takes 2-3 minutes of eyeball time. That's **5-10 hours** of repetitive pattern-matching per job — time that could be spent on intake calls, sourcing, or closing.

Rosie compresses that to a single workflow:

1. **Select a job** from your Greenhouse ATS
2. **Generate a scoring rubric** from the job description + intake notes (Claude)
3. **Score every candidate** against the rubric (Claude reads each resume)
4. **Review tier-ranked results** — advance top candidates, reject below-threshold, done

## How It Works

```
Greenhouse ATS                     Claude (Sonnet 4.5)
     │                                    │
     ├── Jobs API ──────────┐              │
     │   (open roles, JDs)  │              │
     │                      ▼              │
     │              ┌──────────────┐       │
     │              │  1. SETUP    │       │
     │              │  Select job, │       │
     │              │  paste JD +  │       │
     │              │  intake notes│       │
     │              └──────┬───────┘       │
     │                     │               │
     │                     ▼               │
     │              ┌──────────────┐       │
     │              │ 2. CALIBRATE │◄──────┤ Generate rubric
     │              │  Review AI   │       │ (must-haves, weights,
     │              │  rubric      │       │  hidden preferences)
     │              └──────┬───────┘       │
     │                     │               │
     ├── Candidates API ───┤               │
     │   (profiles +       │               │
     │    resume files)    ▼               │
     │              ┌──────────────┐       │
     │              │  3. SCORE    │◄──────┤ Score each resume
     │              │  AI reads    │       │ (PDF native, DOCX
     │              │  each resume │       │  via text extraction)
     │              └──────┬───────┘       │
     │                     │               │
     │                     ▼               │
     │              ┌──────────────┐       │
     │              │ 4. RESULTS   │       │
     │              │  Tier-ranked │       │
     │              │  candidates  │       │
     │              └──────────────┘       │
     │                     │               │
     │◄────────────────────┘               │
     │  (Advance/Reject                    │
     │   writebacks — planned)             │
```

### Scoring Model

Each candidate is scored on 4 dimensions (0-10):

| Dimension | What It Measures |
|-----------|-----------------|
| **Technical** | Skills match against rubric requirements, weighted by importance |
| **Experience** | Depth, relevance, company types, role scope, years |
| **Alignment** | Fit with hidden preferences from intake (team culture, working style) |
| **Growth** | Career trajectory, upward mobility, leadership potential |

The overall score uses a **weighted average** (not simple mean) — technical and experience are weighted heavier based on rubric weights. Candidates are then bucketed:

| Tier | Score Range | Action |
|------|------------|--------|
| Top Tier | 9.0 - 10 | Advance to screen |
| Strong | 8.0 - 8.9 | Review individually |
| Moderate | 7.0 - 7.9 | Borderline — review or pass |
| Below Threshold | < 7.0 | Bulk reject |

### Anti-Bias Design

The scoring prompt explicitly instructs Claude:
> Do NOT penalize for demographics, school prestige, or company brand. Score on demonstrated skills and experience.

This is intentional — the model evaluates what candidates *can do*, not where they went to school or which logo is on their resume.

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
│   │   ├── ui/                          # shadcn/ui primitives (shared design system)
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
│   │   ├── ScoringProgress.tsx          # Live scoring progress (Radix Progress)
│   │   ├── ResultsSummary.tsx           # Stats + tier distribution chart
│   │   ├── RubricDisplay.tsx            # Rubric viewer (must-haves, weights)
│   │   ├── IdealPatternsDisplay.tsx     # Few-shot pattern viewer
│   │   ├── TierBadge.tsx                # Color-coded tier label
│   │   └── theme-provider.tsx           # next-themes wrapper
│   └── lib/
│       ├── greenhouse.ts                # Greenhouse Harvest API v1 client
│       ├── anthropic.ts                 # Claude scoring + rubric generation
│       ├── types.ts                     # TypeScript interfaces
│       └── utils.ts                     # cn() helper (clsx + tailwind-merge)
```

### Key Technical Decisions

**Resume parsing strategy**: PDFs are sent to Claude as native [document blocks](https://docs.anthropic.com/en/docs/build-with-claude/pdf-support) (base64 encoded) — Claude reads them directly with no OCR or text extraction needed. DOCX files are extracted to text via [mammoth](https://github.com/mbrn/mammoth.js) since Claude can't read DOCX natively. This covers ~95% of resume formats in Greenhouse.

**Rubric generation as a separate step**: The rubric is generated once per job, not per candidate. This means the recruiter can review and tune it before scoring begins — and it keeps the per-candidate scoring prompt focused and consistent.

**Sequential scoring with abort**: Candidates are scored one at a time (not batched) so the UI can show real-time progress. The user can cancel mid-run. This is deliberate — batch parallelism would be faster but would sacrifice the progress UX and make cancellation messy.

**Shared design system**: The UI components use [shadcn/ui](https://ui.shadcn.com/) primitives and a shared CSS token system (CSS custom properties for colors, radii, fonts) that's consistent with other tools in the suite. Light and dark mode supported via [next-themes](https://github.com/pacocoursey/next-themes), with oklch color space for perceptual consistency in dark mode.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 16](https://nextjs.org/) (App Router, Turbopack) |
| Language | TypeScript |
| AI | [Claude Sonnet 4.5](https://docs.anthropic.com/en/docs/about-claude/models) via Anthropic SDK |
| ATS | [Greenhouse Harvest API v1](https://developers.greenhouse.io/harvest.html) |
| UI | [shadcn/ui](https://ui.shadcn.com/) + [Radix UI](https://www.radix-ui.com/) + [Tailwind CSS v4](https://tailwindcss.com/) |
| Icons | [Lucide React](https://lucide.dev/) |
| Font | [Geist](https://vercel.com/font) (Sans + Mono) |
| Resume Parsing | Native PDF (Claude document blocks) + [mammoth](https://github.com/mbrn/mammoth.js) (DOCX) |
| Theming | [next-themes](https://github.com/pacocoursey/next-themes) (dark default, system-aware) |

## Getting Started

### Prerequisites

- Node.js 18+
- A [Greenhouse Harvest API key](https://developers.greenhouse.io/harvest.html#authentication) (v1, Basic Auth)
- An [Anthropic API key](https://console.anthropic.com/)

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

## Greenhouse API Quirks

A few things I learned the hard way while building the Greenhouse integration:

- The `departments` array can contain `null` entries — always null-check before accessing `.name`
- `/jobs/{id}/job_post` returns a **single object**, not an array (unlike most v1 endpoints)
- Job posts can have `content: null` for internal-only postings — fall back to `internal_content`
- Resume attachments are S3 signed URLs that don't require auth to download
- `is_template` jobs show up in the open jobs list and need to be filtered out
- Mix of PDF and DOCX resumes — you need both parsing strategies

## Roadmap

- [ ] Greenhouse writeback (advance/reject candidates via API)
- [ ] Ideal resume upload (few-shot calibration with top performer resumes)
- [ ] Session persistence (save/resume scoring sessions)
- [ ] Batch scoring with parallelism (configurable concurrency)
- [ ] Score comparison view (side-by-side candidate comparison)
- [ ] Webhook integration (trigger scoring on new applications)

## License

MIT

---

Built by [Sam Vangelos](https://github.com/sam-vangelos) — a recruiter who got tired of reading resumes.
