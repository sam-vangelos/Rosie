import { NextResponse } from 'next/server';
import { getCandidatesForJob, getResumeAttachment } from '@/lib/greenhouse';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { jobId } = await request.json();
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const allCandidates = await getCandidatesForJob(jobId);

    // Filter to applicants in "Application Review" stage only
    // - prospect === false means they applied (not sourced/prospected)
    // - current_stage.name === 'Application Review'
    // - status === 'active' (not rejected or hired)
    const candidates = allCandidates.filter((candidate) => {
      const application = candidate.applications?.find((app) =>
        app.jobs?.some((j) => j.id === jobId)
      );
      if (!application) return false;
      if (application.prospect) return false; // sourced, not applied
      if (application.status !== 'active') return false;
      const stageName = application.current_stage?.name?.toLowerCase() || '';
      return stageName === 'application review';
    });

    console.log(`[candidates] Job ${jobId}: ${allCandidates.length} total → ${candidates.length} in Application Review (applicants only)`);

    // Build candidate metadata with resume attachment info (no downloading)
    const candidateData = candidates.map((candidate) => {
      const application = candidate.applications?.find((app) =>
        app.jobs?.some((j) => j.id === jobId)
      );
      const resumeAttachment = getResumeAttachment(candidate);

      return {
        id: candidate.id,
        name: `${candidate.first_name} ${candidate.last_name}`.trim(),
        email: candidate.email_addresses?.[0]?.value || '',
        company: candidate.company || '',
        title: candidate.title || '',
        applicationStatus: application?.status || 'unknown',
        currentStage: application?.current_stage?.name || 'Unknown',
        appliedAt: application?.applied_at || candidate.created_at,
        source: application?.source?.public_name || 'Unknown',
        resumeUrl: resumeAttachment?.url || null,
        resumeFilename: resumeAttachment?.filename || null,
      };
    });

    const withResumes = candidateData.filter((c) => c.resumeUrl).length;

    return NextResponse.json({
      candidates: candidateData,
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
