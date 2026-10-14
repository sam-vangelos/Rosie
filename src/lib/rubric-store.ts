import { query } from './db';
import type {
  IdealPatterns,
  SavedRubricSummary,
  ScoringRubric,
  ScreeningRunRubric,
} from './types';

interface RubricRow {
  rubric: ScoringRubric;
  ideal_patterns: IdealPatterns | null;
}

interface SavedRubricRow extends RubricRow {
  rubric_version: string;
  calibration_version: string | null;
  job_title: string;
  created_at: Date | string;
}

export async function getRubricRecord(
  rubricVersion: string,
  calibrationVersion: string | null
): Promise<RubricRow | null> {
  const result = await query<RubricRow>(
    `
      select rubric, ideal_patterns
      from rosie_rubrics
      where rubric_version = $1 and calibration_version is not distinct from $2
    `,
    [rubricVersion, calibrationVersion]
  );
  return result.rows[0] || null;
}

export async function getRunRubric(runId: string): Promise<ScreeningRunRubric | null> {
  const result = await query<RubricRow>(
    `
      select b.rubric, b.ideal_patterns
      from rosie_runs r
      left join rosie_rubrics b on b.id = r.rubric_id
      where r.id = $1
    `,
    [runId]
  );
  const row = result.rows[0];
  return row?.rubric ? { rubric: row.rubric, idealPatterns: row.ideal_patterns } : null;
}

export async function listRubricsForJob(
  jobId: number,
  limit = 5
): Promise<SavedRubricSummary[]> {
  const result = await query<SavedRubricRow>(
    `
      select rubric_version, calibration_version, job_title, created_at,
        rubric, ideal_patterns
      from rosie_rubrics
      where job_id = $1
      order by created_at desc
      limit $2
    `,
    [jobId, limit]
  );

  return result.rows.map((row) => ({
    rubricVersion: row.rubric_version,
    calibrationVersion: row.calibration_version,
    jobTitle: row.job_title,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    criteriaNames: row.rubric.criteria.map((criterion) => criterion.name),
    calibrated: row.calibration_version !== null,
    rubric: row.rubric,
    idealPatterns: row.ideal_patterns,
  }));
}

export async function saveRubricRecord(input: {
  rubricVersion: string;
  calibrationVersion: string | null;
  rubric: ScoringRubric;
  idealPatterns: IdealPatterns | null;
}): Promise<RubricRow> {
  await query(
    `
      insert into rosie_rubrics (
        rubric_version, calibration_version, rubric, ideal_patterns
      ) values ($1, $2, $3, $4)
      on conflict (rubric_version, calibration_version) do nothing
    `,
    [input.rubricVersion, input.calibrationVersion, input.rubric, input.idealPatterns]
  );
  const stored = await getRubricRecord(input.rubricVersion, input.calibrationVersion);
  if (!stored) throw new Error('Failed to save rubric');
  return stored;
}
