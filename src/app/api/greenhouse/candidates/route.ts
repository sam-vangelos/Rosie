import { NextResponse } from 'next/server';
import { listScreenableCandidatesForJob } from '@/lib/greenhouse-candidates';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { jobId } = await request.json();
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const { candidates: candidateData } = await listScreenableCandidatesForJob(jobId);

    const withResumes = candidateData.filter((c) => c.resumeFilename).length;

    return NextResponse.json({
      total: candidateData.length,
      withResumes,
      withoutResumes: candidateData.length - withResumes,
    });
  } catch (error) {
    console.error('Greenhouse candidates error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch candidates' },
      { status: 500 }
    );
  }
}
