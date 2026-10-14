/**
 * Postgres `text` columns cannot store NUL (0x00): the driver rejects the whole
 * statement with `invalid byte sequence for encoding "UTF8": 0x00`. Some PDFs
 * and DOCX files extract with embedded NULs, which took out 18 candidates
 * across the 2026-07-31 runs — the insert failed, and because the artifacts
 * stage attributes any thrown error to the candidate, each one was recorded as
 * a per-candidate failure rather than a storage defect.
 *
 * NUL is also meaningless inside resume prose, so stripping it at extraction
 * keeps it out of both the database and the model prompt. Only 0x00 is removed:
 * every other control character is legal in a Postgres text column, and
 * widening this would change extracted text for resumes that parse correctly
 * today.
 */
export function stripNulBytes(text: string): string;
export function stripNulBytes(text: string | null | undefined): string | null;
export function stripNulBytes(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  return text.replace(/\u0000/g, '');
}
