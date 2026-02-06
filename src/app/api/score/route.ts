import { NextResponse } from 'next/server';
import { scoreCandidate } from '@/lib/anthropic';
import { ScoringRubric, IdealPatterns, Tier } from '@/lib/types';

export const maxDuration = 60;

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

    const tier = assignTier(result.overallScore);

    return NextResponse.json({
      candidate: {
        id: String(candidate.id),
        greenhouseId: candidate.id,
        greenhouseUrl: `https://app.greenhouse.io/people/${candidate.id}`,
        name: candidate.name,
        email: candidate.email,
        currentRole: candidate.title || 'Unknown',
        currentCompany: candidate.company || 'Unknown',
        yearsExperience: 0,
        scores: result.scores,
        overallScore: result.overallScore,
        tier,
        strengths: result.strengths,
        gaps: result.gaps,
        reasoning: result.reasoning,
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
