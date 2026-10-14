import type { IdealPatterns, ScoringRubric } from './types';

const scoringGuideSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['high', 'mid', 'low'],
  properties: {
    high: { type: 'string' },
    mid: { type: 'string' },
    low: { type: 'string' },
  },
};

const criterionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'description', 'weight', 'scoringGuide'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    weight: { type: 'number' },
    scoringGuide: scoringGuideSchema,
  },
};

export const rubricSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['criteria', 'tableStakes'],
  properties: {
    criteria: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      items: criterionSchema,
    },
    tableStakes: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

export const calibratedRubricSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['criteria', 'tableStakes', 'calibrationSummary'],
  properties: {
    criteria: {
      type: 'array',
      minItems: 3,
      maxItems: 4,
      items: criterionSchema,
    },
    tableStakes: {
      type: 'array',
      items: { type: 'string' },
    },
    calibrationSummary: { type: 'string' },
  },
};

const frequencySchema = {
  type: 'string',
  enum: ['all', 'most', 'some'],
};

export const idealPatternsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['commonSkills', 'careerPatterns', 'achievementSignals'],
  properties: {
    commonSkills: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['skill', 'frequency'],
        properties: {
          skill: { type: 'string' },
          frequency: frequencySchema,
        },
      },
    },
    careerPatterns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pattern', 'frequency'],
        properties: {
          pattern: { type: 'string' },
          frequency: frequencySchema,
        },
      },
    },
    achievementSignals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['signal', 'examples'],
        properties: {
          signal: { type: 'string' },
          examples: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  },
};

export const calibrationAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['patterns', 'calibratedRubric'],
  properties: {
    patterns: idealPatternsSchema,
    calibratedRubric: calibratedRubricSchema,
  },
};

export const scoringResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['criterionScores', 'strengths', 'gaps', 'currentRole', 'currentCompany'],
  properties: {
    criterionScores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['criterionId', 'score', 'evidence'],
        properties: {
          criterionId: { type: 'string' },
          score: { type: 'number' },
          evidence: { type: 'string' },
        },
      },
    },
    strengths: {
      type: 'array',
      items: { type: 'string' },
    },
    gaps: {
      type: 'array',
      items: { type: 'string' },
    },
    currentRole: { type: 'string' },
    currentCompany: { type: 'string' },
  },
};

export const triageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['bucket', 'confidence', 'needsFullScore', 'rationale', 'currentRole', 'currentCompany'],
  properties: {
    bucket: {
      type: 'string',
      enum: ['top_signal', 'borderline', 'likely_no'],
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    needsFullScore: {
      type: 'boolean',
    },
    rationale: {
      type: 'string',
    },
    currentRole: { type: 'string' },
    currentCompany: { type: 'string' },
  },
};

export function sanitizeSchemaForAnthropic(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchemaForAnthropic);
  }

  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const stripped = Object.entries(schema as Record<string, unknown>)
    .filter(([key]) =>
      ![
        'minimum',
        'maximum',
        'exclusiveMinimum',
        'exclusiveMaximum',
        'minLength',
        'maxLength',
        'minItems',
        'maxItems',
        'pattern',
        'format',
      ].includes(key)
    )
    .map(([key, value]) => [key, sanitizeSchemaForAnthropic(value)]);

  return Object.fromEntries(stripped);
}

export function buildCriteriaInstructions(rubric: ScoringRubric): string {
  return rubric.criteria
    .map(
      (criterion, index) => `${index + 1}. **${criterion.name}** (id: "${criterion.id}", weight: ${
        criterion.weight
      }%)
- ${criterion.description}
- 9-10: ${criterion.scoringGuide.high}
- 6-8: ${criterion.scoringGuide.mid}
- 1-5: ${criterion.scoringGuide.low}`
    )
    .join('\n\n');
}

export function buildCompactRubricSummary(rubric: ScoringRubric): string {
  return rubric.criteria
    .map(
      (criterion, index) =>
        `${index + 1}. ${criterion.name} (${criterion.weight}%): ${criterion.description}`
    )
    .join('\n');
}

export function buildPatternsSection(
  rubric: ScoringRubric,
  idealPatterns: IdealPatterns | null
): string {
  if (rubric.calibrationSummary) {
    return `\n## What the exemplar resumes demonstrated\n${rubric.calibrationSummary}\n\nCandidates matching these patterns should score higher. Candidates who do NOT match these patterns — especially on skills tagged 'all' frequency — should score significantly lower on the relevant criterion.`;
  }

  if (!idealPatterns) {
    return '';
  }

  return `\n## Exemplar resume patterns\n${JSON.stringify(idealPatterns, null, 2)}`;
}

export function buildTriageSystemText(
  rubric: ScoringRubric,
  idealPatterns: IdealPatterns | null
): string {
  return `You are doing a fast first-pass recruiter triage. This is ranking support only. You are NOT auto-rejecting anyone.

## Rubric Summary
${buildCompactRubricSummary(rubric)}

## Table Stakes
${rubric.tableStakes.length > 0 ? rubric.tableStakes.join(', ') : 'none'}
${buildPatternsSection(rubric, idealPatterns)}

## Task
Classify the candidate into one of three buckets:
- top_signal: resume already shows strong evidence this candidate merits full scoring
- borderline: unclear or mixed; still merits full scoring
- likely_no: currently looks materially weak against the rubric and probably not worth full scoring

Rules:
- Use likely_no only when the resume is clearly weak on the rubric's actual discriminators.
- If you are uncertain, choose borderline.
- Do not infer capabilities from company names alone.
- currentRole/currentCompany must come from the most recent role explicitly shown in the resume.
- confidence is 0-1.
- needsFullScore should be true for top_signal and borderline, and false for likely_no unless the case is unusually ambiguous.
- rationale must be one terse sentence grounded in concrete resume evidence.`;
}

export function buildTriageResumeBlock(resumeText: string): string {
  return `## Resume\n${resumeText || 'No resume available for this candidate.'}`;
}

export function buildTriageInstructionBlock(candidateName: string): string {
  return `Candidate: ${candidateName}. Classify this candidate using the system prompt. Return ONLY a JSON object matching the schema.`;
}

export function buildScoreSystemText(
  rubric: ScoringRubric,
  idealPatterns: IdealPatterns | null
): string {
  return `You are scoring a candidate against a recruiting rubric. Be terse — every field has a max length.

## Criteria
${buildCriteriaInstructions(rubric)}
${buildPatternsSection(rubric, idealPatterns)}

## Table Stakes
${rubric.tableStakes.length > 0 ? rubric.tableStakes.join(', ') : 'none'}

## Rules
- Score 0-10 (one decimal). 9-10 = exceptional, 6-8 = adequate, 1-5 = weak. If the resume contains no specific, explicit evidence for a criterion, score 3 or below. Do not infer capabilities from job titles or company names alone. "Works at DeepMind" is not evidence of RL depth.
- Apply the scoring guides strictly. Read the 9-10, 6-8, and 1-5 descriptions for each criterion. A score of 9-10 requires the candidate to match the 9-10 description with multiple specific examples. A single mention or bullet point is 6-8 at most. Do not round up.
- Evidence must cite specific text from the resume — a project name, a metric, a system built, a technique used. If your evidence is generic (e.g., "has relevant experience"), your score is too high.
- Evidence: ONE sentence max. Cite specific facts (job title, company, project, metric). No filler.
- Strengths/gaps: short phrases, 8-10 words max each.
- Extract currentRole and currentCompany from the MOST RECENT position in the resume.
- Do NOT score table-stakes skills.`;
}

export function buildScoreResumeTextBlock(resumeText: string | null): string {
  return `## Candidate Resume\n${resumeText || 'No resume available for this candidate.'}`;
}

export function buildScoreResumePdfBlock(fileName: string): string {
  return `## Candidate Resume\nRead the candidate resume from ${fileName}.`;
}

export function buildScoreInstructionBlock(candidateName: string): string {
  return `Candidate: ${candidateName}. Score this candidate against the criteria in the system prompt. Return ONLY a JSON object matching the schema.`;
}

export function buildGenerateRubricPrompt(
  jobDescription: string,
  intakeNotes: string
): string {
  return `You are an expert technical recruiter designing a discriminative scoring instrument. Your goal is NOT to restate the job description — the recruiter already knows the role. Your goal is to identify the 3-5 signals that separate the top 5% of candidates from the other 95%.

## Job Description
${jobDescription}

## Intake Notes
${intakeNotes || 'No intake notes provided.'}

## Your Task

Analyze this role and produce a scoring rubric with two parts. Read the HARD CONSTRAINTS section carefully before generating any criteria.

### Part 1: Discriminative Criteria (3-4 criteria)

Each criterion must represent a dimension where candidates will MEANINGFULLY DIFFER. These are NOT generic categories like "technical skills" or "experience level" — they are specific, role-relevant signals.

For example, for an "RL Gym Engineer" role, instead of one "RL experience" bucket, you'd create separate criteria for:
- RL environment design (built gyms from scratch vs. used existing ones)
- Reward function engineering (designed reward functions vs. applied standard ones)
- Agent architecture (built autonomous agents vs. fine-tuned existing models)

Each criterion needs:
- **id**: Short kebab-case identifier (e.g., "rl-env-design")
- **name**: Human-readable name (e.g., "RL Environment Design & Architecture")
- **description**: What this criterion measures and why it's discriminative
- **weight**: How much this criterion matters relative to others (all criteria weights must sum to 100)
- **scoringGuide**: Concrete descriptions of what each score range looks like:
  - **high** (9-10): What the top 5% of candidates look like on this dimension
  - **mid** (6-8): What an adequate candidate looks like
  - **low** (1-5): What a weak or missing signal looks like

## HARD CONSTRAINTS (violations = rubric failure)
- Every criterion MUST be specific to this exact role. Test: if the criterion would make sense on a rubric for a different job title, it fails and must be replaced.
- Generic engineering skills are NEVER criteria. Team leadership, full-stack design, operational excellence, system design, project management, client relationships, scaled operations — these are table stakes or irrelevant. Never score them.
- At least 60% of total weight MUST go to the core technical specialization described in the JD and intake notes.
- Maximum 3-4 criteria. Fewer criteria = less room for filler.
- Before outputting, self-check: "Would these exact criteria appear on any other job's rubric?" If yes, revise until they would not.

Rules for criteria:
- Each criterion should produce a SPREAD of scores across a typical applicant pool. If 80% of applicants would score the same, it's not discriminative.
- Split broad categories into meaningful sub-specializations when they exist.
- Weight the criteria by their importance to THIS specific role, not generic importance.
- Include signals from intake notes that aren't in the JD.

### Part 2: Table Stakes (skills NOT scored)

List skills that are baseline requirements but have NO discriminative value for this role. These are skills that any qualified candidate would have — scoring them just adds noise. Examples: Python/SQL for a data science role, Git for any engineering role, "communication skills" for any role.

Return ONLY a JSON object matching the schema.`;
}

export function buildCalibrateRubricPrompt(
  rubric: ScoringRubric,
  idealPatterns: IdealPatterns,
  jobDescription: string
): string {
  return `You are refining a scoring rubric based on patterns extracted from exemplar resumes (the recruiter's best hires or top candidates for similar roles).

## Current Rubric
${JSON.stringify(rubric, null, 2)}

## Patterns from Exemplar Resumes
${JSON.stringify(idealPatterns, null, 2)}

## Job Description (for context)
${jobDescription}

## Your Task

The exemplar resumes reveal what "great" actually looks like for this role. Use these patterns to sharpen the rubric:

1. **Adjust scoring guides**: Update the high/mid/low descriptions in each criterion to reflect what the exemplar candidates actually demonstrated. Be specific — reference the actual skills, trajectories, and achievements from the exemplars.

2. **Adjust weights**: If the exemplars reveal that certain criteria matter more (or less) than the initial rubric assumed, adjust weights. Weights must still sum to 100.

3. **Add/remove criteria**: If the exemplars reveal a discriminative signal not captured by the current criteria, add it (and remove a less useful one to stay at 3-4 total). If a current criterion doesn't actually discriminate given what the exemplars show, remove it.

4. **Strip generic criteria**: Any criterion that would make sense on a rubric for a different job title MUST be removed or replaced with a role-specific alternative. Generic engineering skills (team leadership, full-stack design, operational excellence, system design, project management, client relationships, scaled operations) are NEVER criteria — move them to table stakes or delete them. At least 60% of total weight must go to the core technical specialization.

5. **Update table stakes**: If the exemplars reveal that a currently-scored criterion is actually table stakes (all exemplars have it, so it doesn't discriminate), move it to table stakes.

6. **Write a calibration summary**: A plain-English explanation (2-4 sentences) of how the exemplar resumes shifted the scoring model. This is shown to the recruiter so they understand what changed.

Return ONLY a JSON object matching the schema.`;
}

export function buildExtractPatternsPrompt(resumeTexts: string[]): string {
  const resumeSection = resumeTexts
    .map((text, index) => `### Resume ${index + 1}\n${text}`)
    .join('\n\n---\n\n');

  return `You are analyzing ${resumeTexts.length} resumes of ideal/top-performing candidates for a role. Extract common patterns that define what "good" looks like.

## Resumes
${resumeSection}

## Instructions
Analyze these resumes and extract:

1. **commonSkills**: Skills that appear across the resumes. Each has "skill" (string) and "frequency" ("all" if in every resume, "most" if in majority, "some" if in minority).
2. **careerPatterns**: Common career trajectory patterns. Each has "pattern" (string describing the trajectory) and "frequency" ("all"/"most"/"some").
3. **achievementSignals**: Types of achievements that signal quality. Each has "signal" (string describing the pattern) and "examples" (array of specific examples from the resumes).

Return ONLY a JSON object matching the schema.`;
}

export function buildCalibrationAnalysisPrompt({
  rubric,
  jobDescription,
  resumeTexts,
}: {
  rubric: ScoringRubric;
  jobDescription: string;
  resumeTexts: string[];
}): string {
  const resumeSection = resumeTexts
    .map((text, index) => `### Resume ${index + 1}\n${text}`)
    .join('\n\n---\n\n');

  return `You are calibrating a resume-scoring model from a small set of exemplar resumes. Do two things in one pass:

1. Extract the common patterns across the exemplar resumes.
2. Rewrite the scoring rubric so it better reflects what the exemplar set shows great candidates actually look like.

## Current Rubric
${JSON.stringify(rubric, null, 2)}

## Job Description
${jobDescription}

## Exemplar Resumes
${resumeSection}

## Instructions

### A. Extract patterns
Return:
- commonSkills
- careerPatterns
- achievementSignals

### B. Calibrate the rubric
- Keep 3-4 criteria.
- Remove any generic criterion that could appear on another role's rubric.
- Keep at least 60% of total weight on the role's core specialization.
- Rewrite the scoring guides so the 9-10 band reflects what the exemplar set actually demonstrates.
- Move non-discriminative skills into tableStakes.
- Write a concise calibrationSummary explaining what changed and what the model will prioritize.

Return ONLY a JSON object matching the schema.`;
}
