import { NextResponse } from 'next/server';
import { downloadAttachment } from '@/lib/greenhouse';

export const maxDuration = 300;

// Truncate resume text to keep batch responses well under 1MB.
// 50KB ≈ 12,500 words — more than enough for any resume.
const MAX_TEXT_LENGTH = 50_000;

interface InputCandidate {
  id: number;
  name: string;
  email: string;
  company: string;
  title: string;
  applicationStatus: string;
  currentStage: string;
  appliedAt: string;
  source: string;
  resumeUrl: string | null;
  resumeFilename: string | null;
}

interface ProcessedCandidate {
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
    const { candidates } = await request.json() as { candidates: InputCandidate[] };

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return NextResponse.json(
        { error: 'candidates[] is required' },
        { status: 400 }
      );
    }

    const results: ProcessedCandidate[] = [];
    const errors: { candidateId: number; name: string; error: string }[] = [];

    // Download and process resumes in parallel within the batch
    const downloadResults = await Promise.allSettled(
      candidates.map(async (candidate) => {
        if (!candidate.resumeUrl || !candidate.resumeFilename) {
          return { candidate, downloaded: null };
        }
        const downloaded = await downloadAttachment(
          candidate.resumeUrl,
          candidate.resumeFilename
        );
        return { candidate, downloaded };
      })
    );

    for (const result of downloadResults) {
      if (result.status === 'rejected') {
        console.error('[process] Unexpected download rejection:', result.reason);
        continue;
      }

      const { candidate, downloaded } = result.value;
      let resumeText: string | null = null;
      let resumeMimeType: string | null = null;

      if (downloaded) {
        if (downloaded.extractedText) {
          resumeText = downloaded.extractedText;
          if (resumeText.length > MAX_TEXT_LENGTH) {
            resumeText = resumeText.slice(0, MAX_TEXT_LENGTH);
          }
          resumeMimeType = 'text/plain';
        } else {
          console.warn(
            `[process] Text extraction failed for candidate ${candidate.id} (${candidate.name}), file: ${candidate.resumeFilename}`
          );
          errors.push({
            candidateId: candidate.id,
            name: candidate.name,
            error: 'Text extraction failed — candidate will be scored without resume content',
          });
        }
      } else if (candidate.resumeUrl) {
        console.error(
          `[process] Resume download failed for candidate ${candidate.id} (${candidate.name}), file: ${candidate.resumeFilename}`
        );
        errors.push({
          candidateId: candidate.id,
          name: candidate.name,
          error: 'Resume download failed',
        });
      }

      results.push({
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        company: candidate.company,
        title: candidate.title,
        applicationStatus: candidate.applicationStatus,
        currentStage: candidate.currentStage,
        appliedAt: candidate.appliedAt,
        source: candidate.source,
        resumeFilename: candidate.resumeFilename,
        resumeBase64: null, // text only — keeps response small
        resumeMimeType,
        resumeText,
      });
    }

    return NextResponse.json({ candidates: results, errors });
  } catch (error) {
    console.error('Process candidates error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process candidates' },
      { status: 500 }
    );
  }
}
