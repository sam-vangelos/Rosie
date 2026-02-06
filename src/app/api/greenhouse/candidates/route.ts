import { NextResponse } from 'next/server';
import { getCandidatesForJob, getResumeAttachment, downloadAttachment } from '@/lib/greenhouse';

export const maxDuration = 120;

interface CandidateWithResume {
  id: number;
  name: string;
  email: string;
  company: string;
  title: string;
  applicationStatus: string;
  currentStage: string;
  appliedAt: string;
  source: string;
  resumeFilename: string | null;
  resumeBase64: string | null;
  resumeMimeType: string | null;
  resumeText: string | null;
}

export async function POST(request: Request) {
  try {
    const { jobId, includeResumes = true } = await request.json();
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const candidates = await getCandidatesForJob(jobId);
    const results: CandidateWithResume[] = [];

    for (const candidate of candidates) {
      const application = candidate.applications?.find((app) =>
        app.jobs?.some((j) => j.id === jobId)
      );

      const email = candidate.email_addresses?.[0]?.value || '';
      const resumeAttachment = getResumeAttachment(candidate);

      let resumeBase64: string | null = null;
      let resumeMimeType: string | null = null;
      let resumeText: string | null = null;

      if (includeResumes && resumeAttachment) {
        const downloaded = await downloadAttachment(
          resumeAttachment.url,
          resumeAttachment.filename
        );
        if (downloaded) {
          // For PDFs, send base64 to Claude directly
          // For DOCX, send extracted text
          if (downloaded.mimeType === 'application/pdf') {
            resumeBase64 = downloaded.base64;
            resumeMimeType = downloaded.mimeType;
          } else if (downloaded.extractedText) {
            resumeText = downloaded.extractedText;
            resumeMimeType = 'text/plain';
          } else {
            // Fallback: send base64 anyway, Claude may handle it
            resumeBase64 = downloaded.base64;
            resumeMimeType = downloaded.mimeType;
          }
        }
      }

      results.push({
        id: candidate.id,
        name: `${candidate.first_name} ${candidate.last_name}`.trim(),
        email,
        company: candidate.company || '',
        title: candidate.title || '',
        applicationStatus: application?.status || 'unknown',
        currentStage: application?.current_stage?.name || 'Unknown',
        appliedAt: application?.applied_at || candidate.created_at,
        source: application?.source?.public_name || 'Unknown',
        resumeFilename: resumeAttachment?.filename || null,
        resumeBase64,
        resumeMimeType,
        resumeText,
      });

      // Small delay between downloads to avoid rate limits
      if (includeResumes && resumeAttachment) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    return NextResponse.json({
      candidates: results,
      total: results.length,
      withResumes: results.filter((c) => c.resumeBase64 || c.resumeText).length,
      withoutResumes: results.filter((c) => !c.resumeBase64 && !c.resumeText).length,
    });
  } catch (error) {
    console.error('Greenhouse candidates error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch candidates' },
      { status: 500 }
    );
  }
}
