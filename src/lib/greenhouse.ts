// Greenhouse Harvest API v1 Client
// Uses Basic Auth with API key as username, empty password
import mammoth from 'mammoth';
import { stripNulBytes } from './sanitize-text';

const API_KEY = process.env.GREENHOUSE_API_KEY!;
const BASE_URL = 'https://harvest.greenhouse.io/v1';
export const HARVEST_TIMEOUT_MS = 30_000;
export const ATTACHMENT_TIMEOUT_MS = 60_000;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const HARVEST_MAX_ATTEMPTS = 4;
const ATTACHMENT_MAX_ATTEMPTS = 2;
const MAX_RETRY_DELAY_MS = 60_000;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let sleep = defaultSleep;

// Test-only hook: avoids real retry delays without changing production behavior.
export function __setTestOverrides(overrides?: { sleep?: typeof sleep }): void {
  sleep = overrides?.sleep || defaultSleep;
}

class GreenhouseApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function getAuthHeader(): string {
  return 'Basic ' + Buffer.from(API_KEY + ':').toString('base64');
}

async function ghFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  for (let attempt = 1; attempt <= HARVEST_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: getAuthHeader() },
        signal: AbortSignal.timeout(HARVEST_TIMEOUT_MS),
      });

      if (res.ok) {
        const data = await res.json();
        return data;
      }

      let body: string;
      try {
        body = await res.text();
      } catch (error) {
        body = `failed to read response body: ${error instanceof Error ? error.message : String(error)}`;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === HARVEST_MAX_ATTEMPTS) {
        const attempts = retryable ? ` after ${attempt} attempts` : '';
        throw new GreenhouseApiError(
          res.status,
          `Greenhouse API error ${res.status}${attempts}: ${body}`
        );
      }

      const retryAfterHeader = res.status === 429 ? res.headers.get('Retry-After') : null;
      const retryAfter = retryAfterHeader?.trim() ? Number(retryAfterHeader) : NaN;
      const delay = Number.isFinite(retryAfter) && retryAfter >= 0
        ? Math.min(retryAfter * 1_000, MAX_RETRY_DELAY_MS)
        : Math.random() * Math.min(1_000 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
      await sleep(delay);
    } catch (error) {
      if (error instanceof GreenhouseApiError) throw error;
      if (error instanceof SyntaxError) throw error;
      if (attempt === HARVEST_MAX_ATTEMPTS) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Greenhouse API error network/abort after ${attempt} attempts: ${message}`
        );
      }
      await sleep(Math.random() * Math.min(1_000 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS));
    }
  }

  throw new Error('Greenhouse API request failed');
}

// Paginate through all results
async function ghFetchAll<T>(path: string, params?: Record<string, string>): Promise<T[]> {
  const allResults: T[] = [];
  let page = 1;
  const perPage = '100';

  while (true) {
    const pageParams = { ...params, per_page: perPage, page: String(page) };
    const results = await ghFetch<T[]>(path, pageParams);
    allResults.push(...results);

    if (results.length < parseInt(perPage)) break;
    page++;

    // Small delay to avoid rate limits
    await sleep(100);
  }

  return allResults;
}

// Types for Greenhouse API responses
export interface GHHiringTeamMember {
  id: number;
  name: string;
  first_name?: string;
  last_name?: string;
  responsible?: boolean;
}

export interface GHJob {
  id: number;
  name: string;
  status: string;
  departments: { id: number; name: string }[];
  offices: { id: number; name: string }[];
  opened_at: string;
  closed_at: string | null;
  requisition_id: string | null;
  notes: string | null;
  is_template: boolean;
  openings: { id: number; opening_id: string | null; status: string }[];
  hiring_team?: {
    recruiters?: GHHiringTeamMember[];
    coordinators?: GHHiringTeamMember[];
    hiring_managers?: GHHiringTeamMember[];
    sourcers?: GHHiringTeamMember[];
  };
}

export interface GHUser {
  id: number;
  name: string;
  primary_email_address: string | null;
  emails?: string[];
  disabled: boolean;
  site_admin?: boolean;
}

export interface GHJobPost {
  id: number;
  title: string;
  content: string | null;
  internal_content: string | null;
  active: boolean;
  live: boolean;
  internal: boolean;
  external: boolean;
  job_id: number;
  location: { name: string } | null;
}

export interface GHJobStage {
  id: number;
  name: string;
  priority: number;
}

export interface GHAttachment {
  filename: string;
  url: string;
  type: string;
  created_at: string;
}

export interface GHCandidate {
  id: number;
  first_name: string;
  last_name: string;
  company: string | null;
  title: string | null;
  is_private: boolean;
  created_at: string;
  updated_at: string;
  last_activity: string;
  photo_url: string | null;
  application_ids: number[];
  phone_numbers: { value: string; type: string }[];
  addresses: { value: string; type: string }[];
  email_addresses: { value: string; type: string }[];
  website_addresses: { value: string; type: string }[];
  social_media_addresses: { value: string }[];
  tags: string[];
  applications: GHApplication[];
  attachments: GHAttachment[];
}

export interface GHApplication {
  id: number;
  candidate_id: number;
  prospect: boolean;
  applied_at: string;
  rejected_at: string | null;
  last_activity_at: string;
  location: { address: string } | null;
  source: { id: number; public_name: string } | null;
  credited_to: { id: number; first_name: string; last_name: string } | null;
  rejection_reason: { id: number; name: string; type: { id: number; name: string } } | null;
  rejection_details: object | null;
  jobs: { id: number; name: string }[];
  job_post_id: number | null;
  status: string;
  current_stage: { id: number; name: string } | null;
  answers: { question: string; answer: string }[];
}

// ---- API Methods ----

export async function listJobs(status: 'open' | 'closed' | 'draft' = 'open'): Promise<GHJob[]> {
  return ghFetchAll<GHJob>('/jobs', { status });
}

export async function getAllJobs(): Promise<GHJob[]> {
  return ghFetchAll<GHJob>('/jobs');
}

export async function getJob(jobId: number): Promise<GHJob> {
  return ghFetch<GHJob>(`/jobs/${jobId}`);
}

export async function getUserByEmail(email: string): Promise<GHUser | null> {
  try {
    return await ghFetch<GHUser>('/users', { email });
  } catch (error) {
    if (
      error instanceof GreenhouseApiError &&
      (error.status === 404 ||
        (error.status < 500 && /\bnot[\s_-]*found\b/i.test(error.message)))
    ) {
      return null;
    }
    throw error;
  }
}

export async function getJobStages(jobId: number): Promise<GHJobStage[]> {
  return ghFetchAll<GHJobStage>(`/jobs/${jobId}/stages`);
}

export async function getJobPost(jobId: number): Promise<GHJobPost | null> {
  try {
    // v1 returns a single object for /jobs/{id}/job_post
    const post = await ghFetch<GHJobPost>(`/jobs/${jobId}/job_post`);
    if (!post) throw new Error('Greenhouse returned an empty job post response');
    return post;
  } catch (error) {
    if (error instanceof GreenhouseApiError && error.status === 404) return null;
    throw error;
  }
}

export async function getCandidatesForJob(jobId: number): Promise<GHCandidate[]> {
  return ghFetchAll<GHCandidate>('/candidates', { job_id: String(jobId) });
}

export async function getCandidate(candidateId: number): Promise<GHCandidate> {
  return ghFetch<GHCandidate>(`/candidates/${candidateId}`);
}

// Allowlist for remote attachment fetches (defense-in-depth against SSRF)
const ALLOWED_ATTACHMENT_HOSTS = [
  '.amazonaws.com',   // S3 signed URLs from Greenhouse
  '.greenhouse.io',   // Greenhouse-hosted assets
];

function isAllowedAttachmentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_ATTACHMENT_HOSTS.some(suffix => parsed.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

// Download a resume attachment and return base64 + extracted text for DOCX
export async function downloadAttachment(
  url: string,
  filename: string
): Promise<
  | { ok: true; base64: string; mimeType: string; extractedText: string | null }
  | { ok: false; reason: string }
> {
  if (!isAllowedAttachmentUrl(url)) {
    console.error(`[downloadAttachment] Blocked fetch to disallowed URL: ${url.slice(0, 80)}...`);
    return { ok: false, reason: 'blocked URL host' };
  }

  for (let attempt = 1; attempt <= ATTACHMENT_MAX_ATTEMPTS; attempt++) {
    try {
      let currentUrl = url;
      let redirects = 0;
      let res: Response;
      while (true) {
        res = await fetch(currentUrl, {
          redirect: 'manual',
          signal: AbortSignal.timeout(ATTACHMENT_TIMEOUT_MS),
        });
        if (res.status < 300 || res.status >= 400) break;
        const location = res.headers.get('location');
        if (!location) return { ok: false, reason: 'redirect missing location' };
        const nextUrl = new URL(location, currentUrl).toString();
        if (!isAllowedAttachmentUrl(nextUrl)) {
          return { ok: false, reason: 'redirect to disallowed host' };
        }
        if (redirects >= 3) return { ok: false, reason: 'too many redirects' };
        redirects += 1;
        currentUrl = nextUrl;
      }
      if (!res.ok) {
        if (res.status >= 500 && attempt < ATTACHMENT_MAX_ATTEMPTS) {
          await sleep(Math.random() * 1_000 * 2 ** (attempt - 1));
          continue;
        }
        const attempts = res.status >= 500 ? ` after ${attempt} attempts` : '';
        return { ok: false, reason: `HTTP ${res.status} downloading attachment${attempts}` };
      }

      const contentLength = Number(res.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_ATTACHMENT_BYTES) {
        return {
          ok: false,
          reason: `attachment too large (${formatMegabytes(contentLength)} > 15MB limit)`,
        };
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const reader = res.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_ATTACHMENT_BYTES) {
            await reader.cancel().catch(() => {});
            return {
              ok: false,
              reason: `attachment too large (${formatMegabytes(totalBytes)} > 15MB limit)`,
            };
          }
          chunks.push(value);
        }
      }

      const contentType = res.headers.get('content-type') || 'application/octet-stream';
      const buffer = Buffer.concat(chunks, totalBytes);
      const base64 = buffer.toString('base64');

      const isDocx =
        filename.toLowerCase().endsWith('.docx') ||
        contentType.includes('wordprocessingml') ||
        contentType.includes('msword');

      const isPdf =
        filename.toLowerCase().endsWith('.pdf') || contentType.includes('pdf');

      let extractedText: string | null = null;

      // Extract text locally — pdf-parse for PDFs, mammoth for DOCX
      if (isPdf) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pdfParse = require('pdf-parse/lib/pdf-parse');
          const result = await pdfParse(buffer);
          extractedText = result.text;
        } catch (err) {
          console.error(`[downloadAttachment] PDF text extraction failed for "${filename}":`, err instanceof Error ? err.message : err);
        }
      } else if (isDocx) {
        try {
          const result = await mammoth.extractRawText({ buffer });
          extractedText = result.value;
        } catch (err) {
          console.error(`[downloadAttachment] DOCX text extraction failed for "${filename}":`, err instanceof Error ? err.message : err);
        }
      }

      return {
        ok: true,
        base64,
        mimeType: isPdf ? 'application/pdf' : contentType,
        // Some PDFs and DOCX files extract with embedded NULs, which Postgres
        // rejects outright. Strip at the point of extraction so no downstream
        // consumer — storage or model prompt — ever sees one.
        extractedText: stripNulBytes(extractedText),
      };
    } catch (error) {
      if (attempt < ATTACHMENT_MAX_ATTEMPTS) {
        await sleep(Math.random() * 1_000 * 2 ** (attempt - 1));
        continue;
      }
      const timedOut = error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError');
      return {
        ok: false,
        reason: timedOut
          ? 'download timed out'
          : `attachment download failed after ${attempt} attempts: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { ok: false, reason: 'attachment download failed' };
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Get the resume attachment URL for a candidate
export function getResumeAttachment(candidate: GHCandidate): GHAttachment | null {
  // Prefer the most recent resume
  const resumes = candidate.attachments
    .filter((a) => a.type === 'resume')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return resumes[0] || null;
}
