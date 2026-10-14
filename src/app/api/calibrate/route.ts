import { NextResponse } from 'next/server';
import {
  ANTHROPIC_CALIBRATION_MODEL,
  analyzeCalibrationResumes,
  extractPatterns,
} from '@/lib/anthropic';
import {
  hashBuffer,
  makeCalibrationVersion,
  stableHash,
} from '@/lib/cache';
import {
  buildPatternsOnlyCalibrationPayload,
  CALIBRATION_MIN_EXEMPLARS,
  resolveEndorsementFloor,
  resolveThresholdStage,
  selectExemplarCascade,
  type CalibrationExemplar,
  type ExemplarRung,
} from '@/lib/calibration-exemplars';
import {
  downloadAttachment,
  getCandidatesForJob,
  getJobStages,
  getResumeAttachment,
  type GHJobStage,
} from '@/lib/greenhouse';
import { getProvider, getRegisteredProviders } from '@/lib/providers';
import {
  assertProviderExecutable,
  ProviderNotExecutableError,
} from '@/lib/providers/config';
import type { ProviderName } from '@/lib/providers/types';
import { getRubricRecord, saveRubricRecord } from '@/lib/rubric-store';
import { RESUME_TEXT_LIMIT } from '@/lib/screening-engine';
import type { IdealPatterns, ScoringRubric } from '@/lib/types';
import mammoth from 'mammoth';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse');

export const maxDuration = 300;

interface CalibrationInput {
  resumeTexts: string[];
  processedFiles: string[];
  exemplarHashes: string[];
  totalFiles: number;
  rubric: ScoringRubric | null;
  jobDescription: string | null;
  provider: ProviderName;
  targetStage: string;
  exemplars: CalibrationExemplar[];
  rungs: ExemplarRung[];
}

class CalibrationRequestError extends Error {}

/**
 * The floor is derived from the stage that signals hiring-manager endorsement:
 * a candidate only leaves "Hiring Manager Review" once the hiring manager has
 * read their resume and advanced them, which is the judgment the rubric is
 * trying to learn. Naming a floor stage directly does not survive contact with
 * requisitions whose ladders differ — one measured ladder has no Onsite stage
 * at all — so ROSIE_CALIBRATION_MIN_STAGE stays available as an explicit
 * inclusive override rather than as the default mechanism.
 */
function resolveCalibrationFloor(stages: GHJobStage[]): {
  floorPriority: number;
  floorLabel: string;
} {
  const available = stages.map((stage) => stage.name).join(', ') || 'none';
  const explicitFloor = process.env.ROSIE_CALIBRATION_MIN_STAGE;

  if (explicitFloor) {
    const threshold = resolveThresholdStage(stages, explicitFloor);
    if (!threshold) {
      throw new CalibrationRequestError(
        `Calibration stage "${explicitFloor}" was not found. Available stages: ${available}`
      );
    }
    return { floorPriority: threshold.priority, floorLabel: threshold.name };
  }

  const endorsementStageName =
    process.env.ROSIE_CALIBRATION_ENDORSEMENT_STAGE || 'Hiring Manager Review';
  const floor = resolveEndorsementFloor(stages, endorsementStageName);
  if (!floor) {
    throw new CalibrationRequestError(
      `Endorsement stage "${endorsementStageName}" was not found, so the exemplar floor cannot be derived. ` +
        `Set ROSIE_CALIBRATION_MIN_STAGE to name the floor stage directly. Available stages: ${available}`
    );
  }

  return {
    floorPriority: floor.floorPriority,
    floorLabel: floor.floorStage?.name ?? `above ${floor.endorsementStage.name}`,
  };
}

function resolveProvider(value: unknown): ProviderName {
  const provider = value ?? 'api';
  if (
    typeof provider !== 'string' ||
    !getRegisteredProviders().includes(provider as ProviderName)
  ) {
    throw new CalibrationRequestError('Unknown or unregistered provider');
  }
  return provider as ProviderName;
}

function trimResumeText(text: string | null): string | null {
  const trimmed = text?.trim();
  return trimmed ? trimmed.slice(0, RESUME_TEXT_LIMIT) : null;
}

function candidateName(candidate: { id: number; first_name: string; last_name: string }): string {
  return `${candidate.first_name} ${candidate.last_name}`.trim() || `Candidate ${candidate.id}`;
}

async function runCalibration(input: CalibrationInput) {
  const providerTag = input.provider === 'api' ? undefined : input.provider;
  const model =
    input.provider === 'api'
      ? ANTHROPIC_CALIBRATION_MODEL
      : getProvider(input.provider).models.full;
  let patterns: IdealPatterns;
  let calibratedRubric: ScoringRubric | null = null;
  let rubricVersion: string | null = null;
  let calibrationVersion: string | null = null;

  if (input.rubric && input.jobDescription) {
    rubricVersion = stableHash(input.rubric);
    calibrationVersion = makeCalibrationVersion({
      rubricVersion,
      exemplarHashes: input.exemplarHashes,
      model,
      provider: providerTag,
    });

    try {
      const cached = await getRubricRecord(rubricVersion, calibrationVersion);
      if (cached?.ideal_patterns) {
        patterns = cached.ideal_patterns;
        calibratedRubric = cached.rubric;
      } else {
        const analysis = await analyzeCalibrationResumes(
          {
            rubric: input.rubric,
            jobDescription: input.jobDescription,
            resumeTexts: input.resumeTexts,
          },
          { model, provider: input.provider }
        );
        patterns = analysis.patterns;
        calibratedRubric = analysis.calibratedRubric;
        const stored = await saveRubricRecord({
          rubricVersion,
          calibrationVersion,
          rubric: calibratedRubric,
          idealPatterns: patterns,
        });
        patterns = stored.ideal_patterns || patterns;
        calibratedRubric = stored.rubric;
      }

      if (!calibratedRubric.calibrationSummary) {
        return buildPatternsOnlyCalibrationPayload({
          patterns,
          calibrationVersion,
          calibrationFailed: true,
          filesProcessed: input.processedFiles,
          totalFiles: input.totalFiles,
          targetStage: input.targetStage,
          exemplars: input.exemplars,
          rungs: input.rungs,
        });
      }

      console.log(
        `[calibrate] Patterns extracted. ${patterns.commonSkills.length} skills, ${patterns.careerPatterns.length} patterns`
      );
      console.log(
        `[calibrate] Rubric calibrated. Summary: ${calibratedRubric.calibrationSummary.slice(0, 100)}...`
      );

      return {
        patterns,
        calibratedRubric,
        calibrationVersion,
        calibrationFailed: false,
        filesProcessed: input.processedFiles,
        totalFiles: input.totalFiles,
        targetStage: input.targetStage,
        exemplars: input.exemplars,
        rungs: input.rungs,
      };
    } catch (error) {
      console.error('[calibrate] Rubric calibration failed, returning uncalibrated:', error);
    }
  }

  patterns = await extractPatterns(input.resumeTexts, {
    model,
    provider: input.provider,
  });
  if (input.rubric && rubricVersion && calibrationVersion) {
    const stored = await saveRubricRecord({
      rubricVersion,
      calibrationVersion,
      rubric: input.rubric,
      idealPatterns: patterns,
    });
    patterns = stored.ideal_patterns || patterns;
  }
  console.log(
    `[calibrate] Patterns extracted. ${patterns.commonSkills.length} skills, ${patterns.careerPatterns.length} patterns`
  );

  return buildPatternsOnlyCalibrationPayload({
    patterns,
    calibrationVersion,
    calibrationFailed: Boolean(input.rubric && input.jobDescription),
    filesProcessed: input.processedFiles,
    totalFiles: input.totalFiles,
    targetStage: input.targetStage,
    exemplars: input.exemplars,
    rungs: input.rungs,
  });
}

function skippedAutoCalibration(input: {
  reason: string;
  targetStage: string;
  exemplars: CalibrationExemplar[];
  totalFiles: number;
  rungs: ExemplarRung[];
}) {
  return {
    skipped: true,
    reason: input.reason,
    targetStage: input.targetStage,
    exemplars: input.exemplars,
    filesProcessed: [],
    totalFiles: input.totalFiles,
    rungs: input.rungs,
  };
}

async function handleJsonCalibration(request: Request) {
  const {
    jobId,
    rubric,
    jobDescription,
    provider: requestedProvider,
  } = (await request.json()) as {
    jobId?: unknown;
    rubric?: unknown;
    jobDescription?: unknown;
    provider?: unknown;
  };

  if (!Number.isInteger(jobId) || (jobId as number) <= 0) {
    throw new CalibrationRequestError('jobId must be a positive integer');
  }
  if (!rubric || typeof rubric !== 'object') {
    throw new CalibrationRequestError('rubric is required');
  }
  if (typeof jobDescription !== 'string' || !jobDescription.trim()) {
    throw new CalibrationRequestError('jobDescription is required');
  }

  const provider = resolveProvider(requestedProvider);
  assertProviderExecutable(provider);
  const resolvedJobId = jobId as number;
  const stages = await getJobStages(resolvedJobId);
  const { floorPriority, floorLabel } = resolveCalibrationFloor(stages);

  const { selected, rungs } = selectExemplarCascade({
    candidates: await getCandidatesForJob(resolvedJobId),
    jobId: resolvedJobId,
    stages,
    floorPriority,
  });
  const selectedExemplars = selected.map(({ candidate, stageName, status, activityAt }) => ({
    name: candidateName(candidate),
    stage: stageName,
    status,
    activityAt,
  }));

  if (selected.length < CALIBRATION_MIN_EXEMPLARS) {
    return skippedAutoCalibration({
      reason: `Auto-calibration skipped: the cascade found ${selected.length} candidate${
        selected.length === 1 ? '' : 's'
      } at "${floorLabel}" or later; at least ${CALIBRATION_MIN_EXEMPLARS} are required. Supply resumes directly, or calibrate on what exists anyway.`,
      targetStage: floorLabel,
      exemplars: selectedExemplars,
      totalFiles: selected.length,
      rungs,
    });
  }

  const downloaded = await Promise.all(
    selected.map(async ({ candidate, stageName, status, activityAt }) => {
      const attachment = getResumeAttachment(candidate);
      if (!attachment) return null;
      const resume = await downloadAttachment(attachment.url, attachment.filename);
      if (!resume.ok) {
        console.warn(
          `[calibrate] Skipping candidate ${candidate.id}: ${resume.reason}`
        );
        return null;
      }
      const text = trimResumeText(resume.extractedText);
      if (!text) return null;

      return {
        text,
        filename: attachment.filename,
        hash: hashBuffer(Buffer.from(resume.base64, 'base64')),
        exemplar: {
          name: candidateName(candidate),
          stage: stageName,
          status,
          activityAt,
        },
      };
    })
  );
  const usable = downloaded.filter((item) => item !== null);

  if (usable.length < CALIBRATION_MIN_EXEMPLARS) {
    return skippedAutoCalibration({
      reason: `Auto-calibration skipped: ${usable.length} of ${selected.length} cascade candidates had readable resume text; at least ${CALIBRATION_MIN_EXEMPLARS} are required.`,
      targetStage: floorLabel,
      exemplars: usable.map((item) => item.exemplar),
      totalFiles: selected.length,
      rungs,
    });
  }

  return runCalibration({
    resumeTexts: usable.map((item) => item.text),
    processedFiles: usable.map((item) => item.filename),
    exemplarHashes: usable.map((item) => item.hash),
    totalFiles: selected.length,
    rubric: rubric as ScoringRubric,
    jobDescription,
    provider,
    targetStage: floorLabel,
    exemplars: usable.map((item) => item.exemplar),
    rungs,
  });
}

async function handleMultipartCalibration(request: Request) {
  const formData = await request.formData();
  const files = formData
    .getAll('resumes')
    .filter((entry): entry is File => entry instanceof File);
  const rubricJson = formData.get('rubric');
  const jobDescription = formData.get('jobDescription');
  const provider = resolveProvider(formData.get('provider'));

  if (files.length === 0) {
    throw new CalibrationRequestError('No resume files provided');
  }
  if (files.length > 10) {
    throw new CalibrationRequestError('Maximum 10 resumes allowed');
  }
  if (rubricJson !== null && typeof rubricJson !== 'string') {
    throw new CalibrationRequestError('rubric must be JSON text');
  }
  if (jobDescription !== null && typeof jobDescription !== 'string') {
    throw new CalibrationRequestError('jobDescription must be text');
  }
  assertProviderExecutable(provider);

  let rubric: ScoringRubric | null = null;
  if (rubricJson) {
    try {
      rubric = JSON.parse(rubricJson) as ScoringRubric;
    } catch {
      throw new CalibrationRequestError('rubric must be valid JSON');
    }
  }

  const fileEntries = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      nameLower: file.name.toLowerCase(),
      buffer: Buffer.from(await file.arrayBuffer()),
    }))
  );
  console.log(
    `[calibrate] Processing ${fileEntries.length} files: ${fileEntries.map((file) => file.name).join(', ')}`
  );

  const results = await Promise.all(
    fileEntries.map(async ({ name, nameLower, buffer }) => {
      let text = '';
      try {
        if (nameLower.endsWith('.pdf')) {
          text = (await pdfParse(buffer)).text;
        } else if (nameLower.endsWith('.docx')) {
          text = (await mammoth.extractRawText({ buffer })).value;
        } else if (nameLower.endsWith('.doc')) {
          try {
            text = (await mammoth.extractRawText({ buffer })).value;
          } catch {
            text = '';
          }
        } else if (nameLower.endsWith('.txt')) {
          text = buffer.toString('utf8');
        }
      } catch (error) {
        console.warn(`[calibrate] Failed to extract text from ${name}:`, error);
      }
      return { name, text: trimResumeText(text) };
    })
  );

  const usable = results.flatMap((result, index) =>
    result.text
      ? [{
          name: result.name,
          text: result.text,
          hash: hashBuffer(fileEntries[index].buffer),
        }]
      : []
  );
  console.log(
    `[calibrate] Extracted text from ${usable.length}/${fileEntries.length} files`
  );

  if (usable.length === 0) {
    throw new CalibrationRequestError(
      'Could not extract text from any uploaded files. Supported: PDF, DOCX, TXT'
    );
  }

  return runCalibration({
    resumeTexts: usable.map((item) => item.text),
    processedFiles: usable.map((item) => item.name),
    exemplarHashes: usable.map((item) => item.hash),
    totalFiles: files.length,
    rubric,
    jobDescription,
    provider,
    targetStage: 'Manual upload',
    exemplars: usable.map((item) => ({
      name: item.name,
      stage: 'Manual upload',
      status: 'uploaded',
    })),
    rungs: [],
  });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers
      .get('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase();
    const payload =
      contentType === 'application/json'
        ? await handleJsonCalibration(request)
        : await handleMultipartCalibration(request);
    return NextResponse.json(payload);
  } catch (error) {
    if (
      error instanceof CalibrationRequestError ||
      error instanceof ProviderNotExecutableError ||
      error instanceof SyntaxError
    ) {
      return NextResponse.json(
        { error: error.message || 'Invalid calibration request' },
        { status: 400 }
      );
    }
    console.error('Calibration error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to process resumes',
      },
      { status: 500 }
    );
  }
}
