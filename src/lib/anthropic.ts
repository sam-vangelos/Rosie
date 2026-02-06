import Anthropic from '@anthropic-ai/sdk';
import { ScoringRubric, IdealPatterns, CandidateScore } from './types';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MODEL = 'claude-sonnet-4-5-20250929';

// ---- Rubric Generation ----

export async function generateRubric(
  jobDescription: string,
  intakeNotes: string
): Promise<ScoringRubric> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `You are an expert technical recruiter building a candidate scoring rubric. Analyze the job description and hiring manager intake notes below, then generate a structured scoring rubric.

## Job Description
${jobDescription}

## Intake Notes
${intakeNotes || 'No intake notes provided.'}

## Instructions
Generate a JSON scoring rubric with these sections:

1. **mustHaves**: Critical requirements. Each has a "requirement" (string), "weight" (number 1-30, all weights across mustHaves + niceToHaves should sum to 100), and optional "flexibility" (string describing acceptable alternatives).

2. **niceToHaves**: Preferred but not required qualifications. Same structure as mustHaves but typically lower weights.

3. **hiddenPreferences**: Implicit preferences extracted from intake notes that aren't in the formal JD. Each has "preference" (string) and "source" (string describing where you inferred it from).

4. **seniorityTarget**: A string describing the target seniority level and years range.

Rules:
- Weights across all mustHaves and niceToHaves should sum to 100
- Extract genuine signals from the intake notes, not just restate the JD
- Be specific about what "good" looks like for each requirement
- Flag any tension between JD requirements and intake note preferences

Respond with ONLY valid JSON matching this schema:
{
  "mustHaves": [{ "requirement": string, "weight": number, "flexibility": string? }],
  "niceToHaves": [{ "requirement": string, "weight": number }],
  "hiddenPreferences": [{ "preference": string, "source": string }],
  "seniorityTarget": string
}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse rubric JSON from Claude response');

  return JSON.parse(jsonMatch[0]) as ScoringRubric;
}

// ---- Pattern Extraction from Ideal Resumes ----

export async function extractPatterns(
  resumeTexts: string[]
): Promise<IdealPatterns> {
  const resumeSection = resumeTexts
    .map((text, i) => `### Resume ${i + 1}\n${text}`)
    .join('\n\n---\n\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
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
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Failed to parse patterns JSON from Claude response');

  return JSON.parse(jsonMatch[0]) as IdealPatterns;
}

// ---- Candidate Scoring ----

export interface ScoringResult {
  scores: CandidateScore;
  overallScore: number;
  strengths: string[];
  gaps: string[];
  reasoning: string;
}

export async function scoreCandidate(
  rubric: ScoringRubric,
  idealPatterns: IdealPatterns | null,
  candidateName: string,
  resumeBase64: string | null,
  resumeText: string | null,
  resumeMimeType: string
): Promise<ScoringResult> {
  // Build the content array
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
    // No resume available - score based on minimal info
    content.push({
      type: 'text',
      text: `## Candidate: ${candidateName}\nNo resume available for this candidate.`,
    });
  }

  // Add the scoring prompt
  const patternsSection = idealPatterns
    ? `\n## Ideal Candidate Patterns (from top performers in similar roles)\n${JSON.stringify(idealPatterns, null, 2)}\n\nUse these patterns as additional signal when scoring. Candidates matching these patterns should receive a boost.`
    : '';

  content.push({
    type: 'text',
    text: `You are an expert technical recruiter scoring a candidate against a role-specific rubric. Be rigorous, fair, and evidence-based.

## Scoring Rubric
${JSON.stringify(rubric, null, 2)}
${patternsSection}

## Scoring Dimensions
Score each dimension 0-10 (one decimal place). Be calibrated: 10 = exceptional/rare, 8-9 = strong, 6-7 = adequate, 4-5 = weak, below 4 = significant gaps.

1. **technical**: How well do their technical skills match the must-have and nice-to-have requirements? Weight this by the rubric weights.
2. **experience**: Depth and relevance of work experience. Consider years, company types, role scope, and progression.
3. **alignment**: Fit with the hidden preferences and cultural signals from intake notes. Startup mentality, communication, autonomy, etc.
4. **growth**: Career trajectory and potential. Are they on an upward path? Could they grow into a leadership role?

The **overallScore** should be a weighted average where technical and experience are weighted more heavily (based on rubric weights), not a simple average.

## Rules
- Base scores ONLY on evidence in the resume. Do not assume skills that aren't demonstrated.
- If information is missing, score that dimension conservatively (5-6 range).
- Be specific in strengths and gaps - cite actual resume content.
- Reasoning should be 2-3 sentences explaining the overall assessment.
- Do NOT penalize for demographics, school prestige, or company brand. Score on demonstrated skills and experience.

Respond with ONLY valid JSON:
{
  "scores": { "technical": number, "experience": number, "alignment": number, "growth": number },
  "overallScore": number,
  "strengths": [string, string, ...],
  "gaps": [string, string, ...],
  "reasoning": string
}`,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Failed to parse scoring JSON for ${candidateName}`);

  const result = JSON.parse(jsonMatch[0]) as ScoringResult;

  // Clamp scores to 0-10 range
  result.scores.technical = Math.min(10, Math.max(0, result.scores.technical));
  result.scores.experience = Math.min(10, Math.max(0, result.scores.experience));
  result.scores.alignment = Math.min(10, Math.max(0, result.scores.alignment));
  result.scores.growth = Math.min(10, Math.max(0, result.scores.growth));
  result.overallScore = Math.min(10, Math.max(0, result.overallScore));

  // Round to 1 decimal
  result.scores.technical = Math.round(result.scores.technical * 10) / 10;
  result.scores.experience = Math.round(result.scores.experience * 10) / 10;
  result.scores.alignment = Math.round(result.scores.alignment * 10) / 10;
  result.scores.growth = Math.round(result.scores.growth * 10) / 10;
  result.overallScore = Math.round(result.overallScore * 10) / 10;

  return result;
}

// ---- Extract text from resume via Claude (for non-PDF formats) ----

export async function extractResumeText(
  base64Data: string,
  mimeType: string,
  filename: string
): Promise<string> {
  // For PDFs, Claude can read directly. For other formats, we do our best.
  if (mimeType === 'application/pdf') {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64Data,
              },
            } as unknown as Anthropic.TextBlockParam,
            {
              type: 'text',
              text: 'Extract all text content from this resume. Preserve the structure (sections, bullet points) but output as plain text. Include all details: name, contact, experience, education, skills, etc.',
            },
          ],
        },
      ],
    });

    return response.content[0].type === 'text' ? response.content[0].text : '';
  }

  // For non-PDF, return a note
  return `[Resume file: ${filename} - format ${mimeType} not directly parseable]`;
}
