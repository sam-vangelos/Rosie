// Greenhouse Harvest API v1 Client
// Uses Basic Auth with API key as username, empty password
import mammoth from 'mammoth';

const API_KEY = process.env.GREENHOUSE_API_KEY!;
const BASE_URL = 'https://harvest.greenhouse.io/v1';

function getAuthHeader(): string {
  return 'Basic ' + Buffer.from(API_KEY + ':').toString('base64');
}

async function ghFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: getAuthHeader() },
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    throw new Error(`Rate limited. Retry after ${retryAfter || '30'} seconds.`);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Greenhouse API error ${res.status}: ${body}`);
  }

  return res.json();
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
    await new Promise((r) => setTimeout(r, 100));
  }

  return allResults;
}

// Types for Greenhouse API responses
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

export async function getJob(jobId: number): Promise<GHJob> {
  return ghFetch<GHJob>(`/jobs/${jobId}`);
}

export async function getJobPost(jobId: number): Promise<GHJobPost | null> {
  try {
    // v1 returns a single object for /jobs/{id}/job_post
    const post = await ghFetch<GHJobPost>(`/jobs/${jobId}/job_post`);
    return post || null;
  } catch {
    return null;
  }
}

export async function getCandidatesForJob(jobId: number): Promise<GHCandidate[]> {
  return ghFetchAll<GHCandidate>('/candidates', { job_id: String(jobId) });
}

export async function getCandidate(candidateId: number): Promise<GHCandidate> {
  return ghFetch<GHCandidate>(`/candidates/${candidateId}`);
}

// Download a resume attachment and return base64 + extracted text for DOCX
export async function downloadAttachment(
  url: string,
  filename: string
): Promise<{ base64: string; mimeType: string; extractedText: string | null } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[downloadAttachment] HTTP ${res.status} downloading "${filename}" from ${url.slice(0, 80)}...`);
      return null;
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

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
        const result = await pdfParse(Buffer.from(buffer));
        extractedText = result.text;
      } catch (err) {
        console.error(`[downloadAttachment] PDF text extraction failed for "${filename}":`, err instanceof Error ? err.message : err);
        extractedText = null;
      }
    } else if (isDocx) {
      try {
        const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
        extractedText = result.value;
      } catch (err) {
        console.error(`[downloadAttachment] DOCX text extraction failed for "${filename}":`, err instanceof Error ? err.message : err);
        extractedText = null;
      }
    }

    return {
      base64,
      mimeType: isPdf ? 'application/pdf' : contentType,
      extractedText,
    };
  } catch (err) {
    console.error(`[downloadAttachment] Failed to download "${filename}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

// Get the resume attachment URL for a candidate
export function getResumeAttachment(candidate: GHCandidate): GHAttachment | null {
  // Prefer the most recent resume
  const resumes = candidate.attachments
    .filter((a) => a.type === 'resume')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return resumes[0] || null;
}
