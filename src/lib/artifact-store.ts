import path from 'node:path';
import { getBytes, putBytes } from './blob-store';
import { query } from './db';
import { stripNulBytes } from './sanitize-text';
import type { ParseQuality } from './types';

export interface ResumeArtifact {
  resumeFilename: string | null;
  resumeMimeType: string | null;
  resumeBase64: string | null;
  resumeText: string | null;
  resumeFingerprint: string | null;
  parseQuality: ParseQuality;
  hasBlob: boolean;
}

interface ArtifactRow {
  resume_fingerprint: string | null;
  resume_filename: string | null;
  resume_mime_type: string | null;
  resume_text: string | null;
  parse_quality: ParseQuality;
  blob_path: string | null;
}

export async function getResumeArtifact(
  artifactKey: string,
  options: { withBytes?: boolean } = {}
): Promise<ResumeArtifact | null> {
  const result = await query<ArtifactRow>(
    `
      select resume_fingerprint, resume_filename, resume_mime_type,
        resume_text, parse_quality, blob_path
      from rosie_resume_artifacts
      where artifact_key = $1
    `,
    [artifactKey]
  );
  const row = result.rows[0];
  if (!row) return null;

  let resumeBase64: string | null = null;
  if (options.withBytes && row.blob_path) {
    const bytes = await getBytes(row.blob_path);
    if (!bytes) {
      throw new Error(`Resume blob not found: ${row.blob_path}`);
    }
    resumeBase64 = bytes.toString('base64');
  }

  return {
    resumeFilename: row.resume_filename,
    resumeMimeType: row.resume_mime_type,
    resumeBase64,
    resumeText: row.resume_text,
    resumeFingerprint: row.resume_fingerprint,
    parseQuality: row.parse_quality,
    hasBlob: Boolean(row.blob_path),
  };
}

export async function saveResumeArtifact(input: {
  artifactKey: string;
  resumeFingerprint: string;
  resumeFilename: string | null;
  resumeMimeType: string | null;
  resumeBase64: string | null;
  resumeText: string | null;
  parseQuality: ParseQuality;
}): Promise<void> {
  const bytes = input.resumeBase64 ? Buffer.from(input.resumeBase64, 'base64') : null;
  let blobPath: string | null = null;

  if (bytes) {
    const extension = path.extname(input.resumeFilename || '').slice(1).toLowerCase() || 'bin';
    blobPath = await putBytes(
      `resumes/${input.resumeFingerprint}.${extension}`,
      bytes,
      input.resumeMimeType || 'application/octet-stream'
    );
  }

  await query(
    `
      insert into rosie_resume_artifacts (
        artifact_key, resume_fingerprint, resume_filename, resume_mime_type,
        resume_text, parse_quality, blob_path, byte_size
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (artifact_key) do nothing
    `,
    [
      input.artifactKey,
      input.resumeFingerprint,
      input.resumeFilename,
      input.resumeMimeType,
      // Last line of defence: a NUL reaching this insert fails the whole
      // statement, and the artifacts stage would record that as the
      // candidate's own failure.
      stripNulBytes(input.resumeText),
      input.parseQuality,
      blobPath,
      bytes?.byteLength || null,
    ]
  );
}
