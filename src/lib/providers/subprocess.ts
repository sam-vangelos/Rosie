import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface SubprocessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface SubprocessOptions {
  argv: string[];
  stdin?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxStdoutBytes?: number;
}

export type SubprocessRunner = (
  opts: SubprocessOptions
) => Promise<SubprocessResult>;

const DEFAULT_MAX_STDOUT_BYTES = 10 * 1024 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;
const KILL_GRACE_MS = 10_000;
const SECRET_PATTERN =
  /(?:sk-ant-|sk-[-A-Za-z0-9_+/=]{20,}|npg_|ghp_|vercel_blob_rw_|postgresql:\/\/)/i;

export function assertNoCredentialLeak(
  serialized: string,
  label: string
): void {
  if (!SECRET_PATTERN.test(serialized)) return;
  throw new Error(`[${label}] Credential-like output blocked`);
}

function errorWithStderr(message: string, stderr: Buffer): Error {
  const tail = stderr.toString('utf8').trim().slice(-500);
  return new Error(tail ? `${message}: ${tail}` : message);
}

export const runSubprocess: SubprocessRunner = async ({
  argv,
  stdin = '',
  cwd,
  env,
  timeoutMs,
  maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES,
}) => {
  const [bin, ...args] = argv;
  if (!bin) throw new Error('Subprocess argv must include a binary');

  return new Promise<SubprocessResult>((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(bin, args, {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = Buffer.alloc(0);
    let failure: string | null = null;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const terminate = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    };
    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const timeoutTimer = setTimeout(() => {
      if (failure) return;
      failure = `${bin} timed out after ${timeoutMs}ms`;
      terminate();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (failure) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        failure = `${bin} stdout exceeded ${maxStdoutBytes} bytes`;
        terminate();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > MAX_STDERR_BYTES) {
        stderr = stderr.subarray(stderr.length - MAX_STDERR_BYTES);
      }
    });
    child.stdin.on('error', () => {
      // The process may exit before consuming stdin; close/error handles the outcome.
    });
    child.once('error', (error) => {
      fail(errorWithStderr(`Failed to spawn ${bin}: ${error.message}`, stderr));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (failure) {
        reject(errorWithStderr(failure, stderr));
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: stderr.toString('utf8'),
        exitCode: code ?? 1,
        durationMs: Date.now() - startedAt,
      });
    });

    child.stdin.end(stdin);
  });
};

export async function withTempDir<T>(
  fn: (dir: string) => Promise<T>
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rosie-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function buildMinimalEnv(
  extra: Record<string, string | undefined>
): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ...extra,
  } as unknown as NodeJS.ProcessEnv;
}
