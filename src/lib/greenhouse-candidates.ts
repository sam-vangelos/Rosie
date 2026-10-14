import { getCandidatesForJob, getResumeAttachment } from './greenhouse';
import { getTargetGreenhouseStage, matchesTargetGreenhouseStage } from './greenhouse-stage';

export interface GreenhouseCandidateMetadata {
  id: number;
  greenhouseUrl: string;
  name: string;
  email: string;
  company: string;
  title: string;
  updatedAt: string;
  applicationStatus: string;
  currentStage: string;
  appliedAt: string;
  source: string;
  resumeFilename: string | null;
  resumeAttachmentUrl: string | null;
  resumeAttachmentCreatedAt: string | null;
}

/**
 * Greenhouse serves each customer from a numbered shard (app2.greenhouse.io,
 * app3.greenhouse.io, ...), and the generic host 404s for sharded tenants —
 * set ROSIE_GREENHOUSE_APP_HOST to your organisation's shard so deep links
 * resolve.
 *
 * Deep-link to the APPLICATION, not the person: candidates who applied to
 * several roles resolve to whichever application Greenhouse picks, which is
 * not necessarily the one being screened. A recruiter following a link from a
 * screen for one requisition could otherwise reject someone on another.
 */
export function buildGreenhouseCandidateUrl(
  candidateId: number,
  applicationId?: number
): string {
  const host = process.env.ROSIE_GREENHOUSE_APP_HOST || 'https://app.greenhouse.io';
  const base = `${host.replace(/\/+$/, '')}/people/${candidateId}`;
  return applicationId ? `${base}/applications/${applicationId}` : base;
}

export async function listScreenableCandidatesForJob(jobId: number): Promise<{
  targetStage: string;
  candidates: GreenhouseCandidateMetadata[];
}> {
  const allCandidates = await getCandidatesForJob(jobId);
  const targetStage = getTargetGreenhouseStage();

  const candidates = allCandidates
    .filter((candidate) => {
      const application = candidate.applications?.find((app) =>
        app.jobs?.some((job) => job.id === jobId)
      );

      if (!application) return false;
      if (application.prospect) return false;
      if (application.status !== 'active') return false;
      return matchesTargetGreenhouseStage(application.current_stage?.name);
    })
    .map((candidate) => {
      const application = candidate.applications?.find((app) =>
        app.jobs?.some((job) => job.id === jobId)
      );
      const resumeAttachment = getResumeAttachment(candidate);

      return {
        id: candidate.id,
        greenhouseUrl: buildGreenhouseCandidateUrl(candidate.id, application?.id),
        name: `${candidate.first_name} ${candidate.last_name}`.trim(),
        email: candidate.email_addresses?.[0]?.value || '',
        company: candidate.company || '',
        title: candidate.title || '',
        updatedAt: candidate.updated_at,
        applicationStatus: application?.status || 'unknown',
        currentStage: application?.current_stage?.name || 'Unknown',
        appliedAt: application?.applied_at || candidate.created_at,
        source: application?.source?.public_name || 'Unknown',
        resumeFilename: resumeAttachment?.filename || null,
        resumeAttachmentUrl: resumeAttachment?.url || null,
        resumeAttachmentCreatedAt: resumeAttachment?.created_at || null,
      };
    });

  return { targetStage, candidates };
}
