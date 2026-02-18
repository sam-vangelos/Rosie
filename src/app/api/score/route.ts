import { NextResponse } from 'next/server';
import { scoreCandidate, computeOverallScore } from '@/lib/anthropic';
import { ScoringRubric, IdealPatterns, Tier } from '@/lib/types';

export const maxDuration = 300;

function assignTier(score: number): Tier {
  if (score >= 9.0) return 'top';
  if (score >= 8.0) return 'strong';
  if (score >= 7.0) return 'moderate';
  return 'below';
}

export async function POST(request: Request) {
  try {
    const {
      rubric,
      idealPatterns,
      candidate,
    }: {
      rubric: ScoringRubric;
      idealPatterns: IdealPatterns | null;
      candidate: {
        id: number;
        name: string;
        email: string;
        company: string;
        title: string;
        resumeBase64: string | null;
        resumeMimeType: string | null;
        resumeFilename: string | null;
        resumeText: string | null;
        applicationStatus: string;
        currentStage: string;
        appliedAt: string;
        source: string;
      };
    } = await request.json();

    if (!rubric) {
      return NextResponse.json({ error: 'rubric is required' }, { status: 400 });
    }

    const result = await scoreCandidate(
      rubric,
      idealPatterns,
      candidate.name,
      candidate.resumeBase64,
      candidate.resumeText,
      candidate.resumeMimeType || 'application/pdf'
    );

    // Compute weighted average in code — deterministic, reproducible
    const overallScore = computeOverallScore(result.criterionScores, rubric);
    const tier = assignTier(overallScore);

    // Use AI-extracted role/company, fall back to Greenhouse metadata
    const currentRole = result.currentRole || candidate.title || 'Unknown';
    const currentCompany = result.currentCompany || candidate.company || 'Unknown';

    return NextResponse.json({
      candidate: {
        id: String(candidate.id),
        greenhouseId: candidate.id,
        greenhouseUrl: `https://app.greenhouse.io/people/${candidate.id}`,
        name: candidate.name,
        email: candidate.email,
        currentRole,
        currentCompany,
        yearsExperience: 0,
        scores: { criterionScores: result.criterionScores },
        overallScore,
        tier,
        strengths: result.strengths,
        gaps: result.gaps,
        reasoning: '',
        resumeFilename: candidate.resumeFilename,
        applicationStatus: candidate.applicationStatus,
        currentStage: candidate.currentStage,
        appliedAt: candidate.appliedAt,
        source: candidate.source,
      },
    });
  } catch (error) {
    console.error('Scoring error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to score candidate' },
      { status: 500 }
    );
  }
}
