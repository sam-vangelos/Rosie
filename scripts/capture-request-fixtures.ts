import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IdealPatterns, ScoringRubric } from '../src/lib/types';

const rubric: ScoringRubric = {
  criteria: [
    {
      id: 'systems-depth',
      name: 'Distributed Systems Depth',
      description: 'Designing reliable distributed systems under real production constraints.',
      weight: 50,
      scoringGuide: {
        high: 'Owned novel distributed architectures at meaningful scale.',
        mid: 'Shipped production services with clear reliability tradeoffs.',
        low: 'Only used existing services without design ownership.',
      },
    },
    {
      id: 'debugging-rigor',
      name: 'Debugging Rigor',
      description: 'Finding root causes in ambiguous, multi-layer failures.',
      weight: 30,
      scoringGuide: {
        high: 'Resolved systemic failures with measured evidence.',
        mid: 'Debugged scoped production incidents independently.',
        low: 'Provides no concrete debugging evidence.',
      },
    },
    {
      id: 'delivery-leverage',
      name: 'Technical Delivery Leverage',
      description: 'Creating tools or systems that multiply engineering output.',
      weight: 20,
      scoringGuide: {
        high: 'Built adopted tooling with quantified organization-wide impact.',
        mid: 'Automated recurring work for a team.',
        low: 'Provides no evidence of reusable leverage.',
      },
    },
  ],
  tableStakes: ['TypeScript', 'SQL'],
  calibrationSummary:
    'Exemplars consistently paired systems ownership with quantified reliability improvements.',
};

const idealPatterns: IdealPatterns = {
  commonSkills: [
    { skill: 'distributed tracing', frequency: 'all' },
    { skill: 'PostgreSQL', frequency: 'most' },
  ],
  careerPatterns: [
    { pattern: 'progressed from service ownership to platform architecture', frequency: 'most' },
  ],
  achievementSignals: [
    {
      signal: 'quantified reliability gains',
      examples: ['Reduced incident recovery time by 42%.'],
    },
  ],
};

const candidateName = 'Avery Fixture';
const resumeText =
  'Avery Fixture\nStaff Engineer, Example Systems\nReduced incident recovery time by 42%.';
const resumeTexts = [
  'Exemplar One\nBuilt a distributed tracing platform used by 12 teams.',
  'Exemplar Two\nRe-architected job processing and cut recovery time by 42%.',
];
const jobDescription = 'Build and operate distributed recruiting infrastructure.';
const intakeNotes = 'Prioritize root-cause debugging and measurable platform leverage.';
const tinyPdfBase64 = 'JVBERi0xLjQKJSVFT0YK';

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortKeys(child)])
  );
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

export async function buildRequestFixtures(): Promise<Record<string, unknown>> {
  const modelEnvNames = [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_FULL_SCORE_MODEL',
    'ANTHROPIC_TRIAGE_MODEL',
    'ANTHROPIC_RUBRIC_MODEL',
    'ANTHROPIC_CALIBRATION_MODEL',
  ] as const;
  const previousEnv = new Map(modelEnvNames.map((name) => [name, process.env[name]]));

  for (const name of modelEnvNames) {
    delete process.env[name];
  }

  const anthropic = await import('../src/lib/anthropic');

  for (const [name, value] of previousEnv) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  return {
    triage: anthropic.buildTriageMessageParams({
      rubric,
      idealPatterns,
      candidateId: 'candidate-fixture',
      candidateName,
      resumeText,
    }),
    scoreText: anthropic.buildScoreMessageParams({
      rubric,
      idealPatterns,
      candidateId: 'candidate-fixture',
      candidateName,
      resumeBase64: tinyPdfBase64,
      resumeText,
      resumeMimeType: 'application/pdf',
      useFileInput: false,
    }),
    scorePdf: anthropic.buildScoreMessageParams({
      rubric,
      idealPatterns,
      candidateId: 'candidate-fixture',
      candidateName,
      resumeBase64: tinyPdfBase64,
      resumeText,
      resumeMimeType: 'application/pdf',
      useFileInput: true,
    }),
    generateRubric: anthropic.buildStructuredJsonParams(
      anthropic.buildGenerateRubricRequest(jobDescription, intakeNotes)
    ),
    calibrateRubric: anthropic.buildStructuredJsonParams(
      anthropic.buildCalibrateRubricRequest(rubric, idealPatterns, jobDescription)
    ),
    extractPatterns: anthropic.buildStructuredJsonParams(
      anthropic.buildExtractPatternsRequest(resumeTexts)
    ),
    analyzeCalibrationResumes: anthropic.buildStructuredJsonParams(
      anthropic.buildCalibrationAnalysisRequest({
        rubric,
        jobDescription,
        resumeTexts,
      })
    ),
  };
}

const currentFile = fileURLToPath(import.meta.url);

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  void (async () => {
    const fixturePath = resolve(dirname(currentFile), 'fixtures/request-params.golden.json');
    const fixtures = await buildRequestFixtures();
    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, `${stableStringify(fixtures)}\n`);
    console.log(`Captured request fixtures at ${fixturePath}`);
  })();
}
