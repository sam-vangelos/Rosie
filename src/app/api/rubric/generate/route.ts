import { NextResponse } from 'next/server';
import { generateRubric } from '@/lib/anthropic';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { jobDescription, intakeNotes } = await request.json();

    if (!jobDescription?.trim()) {
      return NextResponse.json({ error: 'jobDescription is required' }, { status: 400 });
    }

    const rubric = await generateRubric(jobDescription, intakeNotes || '');

    return NextResponse.json({ rubric });
  } catch (error) {
    console.error('Rubric generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate rubric' },
      { status: 500 }
    );
  }
}
