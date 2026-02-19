# Rosie — Discriminative Resume Scoring

Rosie scores resumes against role-specific discriminative criteria. It generates a rubric from a job description, optionally calibrates against top-performer resumes, then scores every applicant against that rubric using Claude — producing tier-ranked results with per-criterion evidence.

The core idea: instead of keyword matching or generic dimensions, identify the 3-4 signals that separate the top 5% of candidates for *this specific role*, then score every resume against those signals.

**[Live Demo](https://rosie-prototype.vercel.app)**

---

## How It Works

1. **Rubric generation** — Claude reads a job description + recruiter intake notes and produces 3-4 discriminative criteria: role-specific signals where candidates will meaningfully differ. Generic skills (team leadership, system design, project management) are excluded as table stakes.

2. **Calibration** *(optional)* — Upload resumes from known top performers. Rosie extracts recurring patterns (skills, career trajectories, achievement signals) and uses them to sharpen the rubric — adjusting scoring guides, weights, and criteria based on what "great" actually looks like.

3. **Per-candidate scoring** — Claude reads each resume natively (PDF as document blocks, DOCX via text extraction) and scores it against each criterion with specific evidence cited from the resume. Scores require explicit proof — no inferences from job titles or company names alone.

4. **Tier ranking** — A weighted average is computed in code (not by Claude), and candidates are bucketed into actionable tiers.

```
                              +---------------------------+
                              |   Job Description +       |
                              |   Recruiter Intake Notes  |
                              +-------------+-------------+
                                            |
                                            v
                              +---------------------------+
                              |   RUBRIC GENERATION       |
                              |   Claude -> 3-4           |
                              |   discriminative criteria |
                              |   + table stakes          |
                              +-------------+-------------+
                                            |
              +-----------------------------+
              |                             |
              v                             v
+------------------------+    +---------------------------+
|  CALIBRATION (optional)|    |   PER-CANDIDATE SCORING   |
|                        |    |                           |
|  Top-performer resumes +--->|   Resume (PDF/DOCX)       |
|  -> extract patterns   |    |     + Rubric              |
|  -> sharpen rubric     |    |     + Calibration context  |
+------------------------+    |     -> Claude -> scores   |
                              |       + evidence          |
                              +-------------+-------------+
                                            |
                                            v
                              +---------------------------+
                              |   TIER-RANKED RESULTS     |
                              |   Top - Strong -          |
                              |   Moderate - Below        |
                              +---------------------------+
```

---

## Scoring Model

Each candidate is scored on 3-4 **discriminative criteria** generated per-role (0-10 per criterion). Criteria are specific to the exact job — e.g., for a Senior CV Engineer role:

| Criterion | Weight |
|-----------|--------|
| Research-to-Production Edge Deployment | 35% |
| Adverse Condition & Edge Case Robustness | 25% |
| Multi-Modal Sensor Fusion for 3D Perception | 25% |
| Sim-to-Real Transfer & Synthetic Data Pipelines | 15% |

Generic skills that any qualified candidate would have are listed as **table stakes** and not scored.

The overall score is a **weighted average** computed in code (deterministic, not by Claude). Candidates are bucketed into tiers:

| Tier | Score Range | Action |
|------|------------|--------|
| Top Tier | 9.0 - 10 | Advance to screen |
| Strong | 8.0 - 8.9 | Review individually |
| Moderate | 7.0 - 7.9 | Borderline — review or pass |
| Below Threshold | < 7.0 | Pass |

Each score comes with cited evidence from the resume — a specific project, metric, system, or technique. No generic "has relevant experience" allowed.

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
│   │   │   ├── calibrate/route.ts       # POST resumes + rubric → calibrated rubric
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
│   │   ├── CandidateCard.tsx            # Expandable score + evidence card
│   │   ├── TierSection.tsx              # Collapsible tier group
│   │   ├── ScoreRing.tsx                # SVG radial score visualization
│   │   ├── ScoringProgress.tsx          # Live scoring progress
│   │   ├── ResultsSummary.tsx           # Stats + tier distribution chart
│   │   ├── RubricDisplay.tsx            # Rubric criteria viewer
│   │   ├── IdealPatternsDisplay.tsx     # Calibration pattern viewer
│   │   └── TierBadge.tsx                # Color-coded tier label
│   └── lib/
│       ├── greenhouse.ts                # ATS integration (Greenhouse Harvest API v1)
│       ├── anthropic.ts                 # Claude calls: generateRubric, extractPatterns,
│       │                                #   calibrateRubric, scoreCandidate, computeOverallScore
│       ├── types.ts                     # TypeScript interfaces
│       └── utils.ts                     # cn() helper (clsx + tailwind-merge)
```

### Key Technical Decisions

**Native PDF reading**: Resumes are sent to Claude as [document blocks](https://docs.anthropic.com/en/docs/build-with-claude/pdf-support) (base64 encoded) — no OCR, no text extraction, no information loss. Claude reads the PDF directly. DOCX files fall back to text extraction via [mammoth](https://github.com/mbrn/mammoth.js).

**Rubric as a first-class object**: The rubric isn't a hidden prompt — it's a structured JSON artifact the recruiter can inspect before scoring begins. This makes the scoring process transparent and auditable.

**Deterministic scoring**: The weighted average is computed in code (`computeOverallScore`), not by Claude. Same criterion scores always produce the same overall score. Claude calls use `temperature: 0` for structured outputs.

**Calibration via pattern extraction**: Rather than stuffing full resumes into the scoring prompt, Rosie extracts recurring patterns from top-performer resumes and uses the calibration summary as narrative context. This keeps the per-candidate context window focused.

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
- A [Greenhouse Harvest API key](https://developers.greenhouse.io/harvest.html#authentication) (v1, Basic Auth)

### Setup

```bash
git clone https://github.com/sam-vangelos/Rosie.git
cd Rosie
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

- [ ] ATS writeback (advance/reject candidates via Greenhouse API)
- [ ] Session persistence (save/resume scoring sessions)
- [ ] Batch scoring with configurable concurrency
- [ ] Score comparison view (side-by-side candidate evaluation)
- [ ] ATS-agnostic adapter layer (Lever, Ashby, Workday)

## License

MIT

---

Built by [Sam Vangelos](https://github.com/sam-vangelos) — a recruiter who got tired of reading resumes.
