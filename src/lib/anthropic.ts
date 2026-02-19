import Anthropic from '@anthropic-ai/sdk';
import { ScoringRubric, IdealPatterns, CriterionScore } from './types';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_RETRIES = 3;

// ---- Retry helper ----

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = MAX_RETRIES
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === retries;
      const isRetryable =
        err instanceof Error &&
        (err.message.includes('rate_limit') ||
          err.message.includes('overloaded') ||
          err.message.includes('529') ||
          err.message.includes('500') ||
          err.message.includes('timeout') ||
          err.message.includes('ECONNRESET'));

      if (isLast || !isRetryable) throw err;

      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      console.warn(`[${label}] Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`[${label}] All ${retries} attempts failed`);
}

// ---- JSON extraction (handles markdown code blocks, nested objects) ----

function extractJSON(text: string, label: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch { /* fall through */ }
  }

  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch { /* fall through */ }
  }

  const start = text.indexOf('{');
  if (start === -1) throw new Error(`No JSON object found in ${label} response`);

  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  if (end === -1) throw new Error(`Unbalanced braces in ${label} response`);

  try {
    return JSON.parse(text.slice(start, end));
  } catch (err) {
    throw new Error(`Failed to parse ${label} JSON: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}

// ---- Rubric Generation ----

export async function generateRubric(
  jobDescription: string,
  intakeNotes: string
): Promise<ScoringRubric> {
  return withRetry(async () => {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: `You are an expert technical recruiter designing a discriminative scoring instrument. Your goal is NOT to restate the job description — the recruiter already knows the role. Your goal is to identify the 3-5 signals that separate the top 5% of candidates from the other 95%.

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
- **weight**: How much this criterion matters relative to others (all weights must sum to 100)
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

Respond with ONLY valid JSON matching this schema:
{
  "criteria": [
    {
      "id": string,
      "name": string,
      "description": string,
      "weight": number,
      "scoringGuide": {
        "high": string,
        "mid": string,
        "low": string
      }
    }
  ],
  "tableStakes": [string]
}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return extractJSON(text, 'rubric') as ScoringRubric;
  }, 'generateRubric');
}

// ---- Calibrate Rubric with Ideal Candidate Patterns ----

export async function calibrateRubric(
  rubric: ScoringRubric,
  idealPatterns: IdealPatterns,
  jobDescription: string
): Promise<ScoringRubric> {
  return withRetry(async () => {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: `You are refining a scoring rubric based on patterns extracted from exemplar resumes (the recruiter's best hires or top candidates for similar roles).

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

6. **Write a calibration summary**: A plain-English explanation (2-4 sentences) of how the exemplar resumes shifted the scoring model. This is shown to the recruiter so they understand what changed. Example: "Based on your 3 exemplar resumes, the model will prioritize candidates who progressed from ML research into applied RL infrastructure, with particular weight on frontier lab experience. Candidates with pure SWE backgrounds but no RL research exposure will score significantly lower."

Respond with ONLY valid JSON matching this schema:
{
  "criteria": [
    {
      "id": string,
      "name": string,
      "description": string,
      "weight": number,
      "scoringGuide": {
        "high": string,
        "mid": string,
        "low": string
      }
    }
  ],
  "tableStakes": [string],
  "calibrationSummary": string
}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return extractJSON(text, 'calibrateRubric') as ScoringRubric;
  }, 'calibrateRubric');
}

// ---- Pattern Extraction from Ideal Resumes ----

export async function extractPatterns(
  resumeTexts: string[]
): Promise<IdealPatterns> {
  if (resumeTexts.length === 0) {
    throw new Error('No resume texts provided for pattern extraction');
  }

  const resumeSection = resumeTexts
    .map((text, i) => `### Resume ${i + 1}\n${text}`)
    .join('\n\n---\n\n');

  return withRetry(async () => {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `You are analyzing ${resumeTexts.length} resumes of ideal/top-performing candidates for a role. Extract common patterns that define what "good" looks like.

## Resumes
${resumeSection}

## Instructions
Analyze these resumes and extract:

1. **commonSkills**: Skills that appear across the resumes. Each has "skill" (string) and "frequency" ("all" if in every resume, "most" if in majority, "some" if in minority).

2. **careerPatterns**: Common career trajectory patterns. Each has "pattern" (string describing the trajectory) and "frequency" ("all"/"most"/"some").

3. **achievementSignals**: Types of achievements that signal quality. Each has "signal" (string describing the pattern) and "examples" (array of specific examples from the resumes).

Respond with ONLY valid JSON matching this schema:
{
  "commonSkills": [{ "skill": string, "frequency": "all"|"most"|"some" }],
  "careerPatterns": [{ "pattern": string, "frequency": "all"|"most"|"some" }],
  "achievementSignals": [{ "signal": string, "examples": [string] }]
}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return extractJSON(text, 'patterns') as IdealPatterns;
  }, 'extractPatterns');
}

// ---- Candidate Scoring ----

export interface ScoringResult {
  criterionScores: CriterionScore[];
  strengths: string[];
  gaps: string[];
  currentRole: string;
  currentCompany: string;
}

export async function scoreCandidate(
  rubric: ScoringRubric,
  idealPatterns: IdealPatterns | null,
  candidateName: string,
  resumeBase64: string | null,
  resumeText: string | null,
  resumeMimeType: string
): Promise<ScoringResult> {
  return withRetry(async () => {
    const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

    // Add the resume - prefer PDF document block, fall back to text
    if (resumeBase64 && resumeMimeType === 'application/pdf') {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: resumeBase64,
        },
      } as unknown as Anthropic.TextBlockParam);
    } else if (resumeText) {
      content.push({
        type: 'text',
        text: `## Candidate Resume\n${resumeText}`,
      });
    } else {
      content.push({
        type: 'text',
        text: `## Candidate: ${candidateName}\nNo resume available for this candidate.`,
      });
    }

    // Build the criteria scoring instructions
    const criteriaInstructions = rubric.criteria
      .map((c, i) => `${i + 1}. **${c.name}** (id: "${c.id}", weight: ${c.weight}%)
   - ${c.description}
   - 9-10: ${c.scoringGuide.high}
   - 6-8: ${c.scoringGuide.mid}
   - 1-5: ${c.scoringGuide.low}`)
      .join('\n\n');

    const patternsSection = idealPatterns
      ? `\n## Calibration Patterns (from top performers in similar roles)\n${JSON.stringify(idealPatterns, null, 2)}\n\nCandidates matching these patterns should receive a scoring boost on relevant criteria.`
      : '';

    content.push({
      type: 'text',
      text: `Score this candidate against these criteria. Be terse — every field has a max length.

## Criteria
${criteriaInstructions}
${patternsSection}

## Rules
- Score 0-10 (one decimal). 9-10 = exceptional, 6-8 = adequate, 1-5 = weak. No evidence = score 3-4.
- Evidence: ONE sentence max. Cite specific facts (job title, company, project, metric). No filler.
- Strengths/gaps: short phrases, 8-10 words max each. Example: "6 yrs frontier lab RL (Google, DeepMind)"
- Extract currentRole and currentCompany from their MOST RECENT position in the resume.
- Do NOT score table-stakes skills: ${rubric.tableStakes.length > 0 ? rubric.tableStakes.join(', ') : 'none'}

Respond with ONLY valid JSON:
{
  "criterionScores": [{ "criterionId": string, "score": number, "evidence": string }],
  "strengths": [string],
  "gaps": [string],
  "currentRole": string,
  "currentCompany": string
}`,
    });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      temperature: 0,
      messages: [{ role: 'user', content }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const result = extractJSON(text, `scoring:${candidateName}`) as ScoringResult;

    // Validate
    if (!Array.isArray(result.criterionScores) || result.criterionScores.length === 0) {
      throw new Error(`Invalid scoring response for ${candidateName}: missing criterionScores`);
    }

    // Clamp scores to 0-10 and round to 1 decimal
    const clampAndRound = (v: number) => Math.round(Math.min(10, Math.max(0, v)) * 10) / 10;
    for (const cs of result.criterionScores) {
      cs.score = clampAndRound(cs.score);
      cs.evidence = cs.evidence || '';
    }

    result.strengths = result.strengths || [];
    result.gaps = result.gaps || [];
    result.currentRole = result.currentRole || '';
    result.currentCompany = result.currentCompany || '';

    return result;
  }, `scoreCandidate:${candidateName}`);
}

// ---- Compute weighted overall score (deterministic, in code) ----

export function computeOverallScore(
  criterionScores: CriterionScore[],
  rubric: ScoringRubric
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const cs of criterionScores) {
    const criterion = rubric.criteria.find((c) => c.id === cs.criterionId);
    const weight = criterion?.weight ?? 0;
    weightedSum += cs.score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;

  const score = weightedSum / totalWeight;
  return Math.round(Math.min(10, Math.max(0, score)) * 10) / 10;
}
