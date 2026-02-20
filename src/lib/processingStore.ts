// In-memory store for candidate processing sessions.
// Persists across requests in Next.js dev mode (long-lived Node process).
// Each session holds candidate metadata + resume S3 URLs from the initial
// Greenhouse fetch, so the batch process endpoint can download resumes
// without re-fetching from Greenhouse.

export interface StoredCandidate {
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

interface ProcessingSession {
  candidates: Map<number, StoredCandidate>;
  createdAt: number;
}

const sessions = new Map<string, ProcessingSession>();

const SESSION_TTL = 60 * 60 * 1000; // 1 hour

function cleanup() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}

export function createSession(
  sessionId: string,
  candidates: StoredCandidate[]
): void {
  cleanup();
  const candidateMap = new Map<number, StoredCandidate>();
  for (const c of candidates) {
    candidateMap.set(c.id, c);
  }
  sessions.set(sessionId, {
    candidates: candidateMap,
    createdAt: Date.now(),
  });
}

export function getSessionCandidates(
  sessionId: string,
  candidateIds: number[]
): StoredCandidate[] {
  const session = sessions.get(sessionId);
  if (!session) return [];
  return candidateIds
    .map((id) => session.candidates.get(id))
    .filter((c): c is StoredCandidate => c != null);
}

export function hasSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}
