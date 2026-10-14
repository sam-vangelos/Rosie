import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setTestOverrides,
  downloadAttachment,
  getJob,
  getJobPost,
  getUserByEmail,
  MAX_ATTACHMENT_BYTES,
} from '../src/lib/greenhouse';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  __setTestOverrides();
});

describe('Greenhouse Harvest retries', () => {
  it('honors Retry-After on 429 and succeeds on retry', async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    __setTestOverrides({ sleep: async (ms) => { sleeps.push(ms); } });
    globalThis.fetch = async () => {
      attempts++;
      return attempts === 1
        ? new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } })
        : Response.json({ id: 123 });
    };

    assert.deepEqual(await getJob(123), { id: 123 });
    assert.equal(attempts, 2);
    assert.deepEqual(sleeps, [1_000]);
  });

  it('throws after exactly four 500 responses', async () => {
    let attempts = 0;
    __setTestOverrides({ sleep: async () => {} });
    globalThis.fetch = async () => {
      attempts++;
      return new Response('server error', { status: 500 });
    };

    await assert.rejects(getJob(123), /Greenhouse API error 500 after 4 attempts/);
    assert.equal(attempts, 4);
  });

  it('does not retry a 400 response', async () => {
    let attempts = 0;
    __setTestOverrides({ sleep: async () => {} });
    globalThis.fetch = async () => {
      attempts++;
      return new Response('bad request', { status: 400 });
    };

    await assert.rejects(getJob(123), /Greenhouse API error 400/);
    assert.equal(attempts, 1);
  });
});

describe('attachment download limits', () => {
  it('rejects Content-Length over the cap without reading the body', async () => {
    let bodyRead = false;
    const response = new Response(null, {
      headers: { 'Content-Length': String(MAX_ATTACHMENT_BYTES + 1) },
    });
    Object.defineProperty(response, 'body', {
      get() {
        bodyRead = true;
        return null;
      },
    });
    globalThis.fetch = async () => response;

    const result = await downloadAttachment('https://files.amazonaws.com/resume.txt', 'resume.txt');
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /15MB limit/);
    assert.equal(bodyRead, false);
  });

  it('rejects a streamed body over the cap without Content-Length', async () => {
    const chunk = new Uint8Array(MAX_ATTACHMENT_BYTES / 2 + 1);
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    }));

    const result = await downloadAttachment('https://files.amazonaws.com/resume.txt', 'resume.txt');
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /attachment too large.*15MB limit/);
  });

  it('blocks disallowed hosts without fetching', async () => {
    let fetched = false;
    globalThis.fetch = async () => {
      fetched = true;
      return new Response();
    };

    assert.deepEqual(
      await downloadAttachment('https://example.com/resume.pdf', 'resume.pdf'),
      { ok: false, reason: 'blocked URL host' }
    );
    assert.equal(fetched, false);
  });

  it('blocks redirects to disallowed hosts', async () => {
    const options: RequestInit[] = [];
    globalThis.fetch = async (_input, init) => {
      options.push(init || {});
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://example.com/stolen.pdf' },
      });
    };

    assert.deepEqual(
      await downloadAttachment('https://files.amazonaws.com/resume.pdf', 'resume.pdf'),
      { ok: false, reason: 'redirect to disallowed host' }
    );
    assert.equal(options[0]?.redirect, 'manual');
  });
});

describe('getJobPost', () => {
  it('returns null for a true 404', async () => {
    globalThis.fetch = async () => new Response('not found', { status: 404 });
    assert.equal(await getJobPost(123), null);
  });

  it('throws after retrying a 500 four times', async () => {
    let attempts = 0;
    __setTestOverrides({ sleep: async () => {} });
    globalThis.fetch = async () => {
      attempts++;
      return new Response('server error', { status: 500 });
    };

    await assert.rejects(getJobPost(123), /Greenhouse API error 500 after 4 attempts/);
    assert.equal(attempts, 4);
  });
});

describe('getUserByEmail', () => {
  it('returns the single user object and sends an encoded email query', async () => {
    let requestedUrl = '';
    const user = {
      id: 42,
      name: 'Test Recruiter',
      primary_email_address: 'recruiter+tag@example.com',
      emails: ['recruiter+tag@example.com'],
      disabled: false,
    };
    globalThis.fetch = async (input) => {
      requestedUrl = input instanceof Request ? input.url : String(input);
      return Response.json(user);
    };

    assert.deepEqual(
      await getUserByEmail('recruiter+tag@example.com'),
      user
    );
    assert.equal(
      new URL(requestedUrl).searchParams.get('email'),
      'recruiter+tag@example.com'
    );
  });

  it('returns null for a non-404 response that indicates not found', async () => {
    globalThis.fetch = async () =>
      new Response('Greenhouse user not found', { status: 422 });

    assert.equal(await getUserByEmail('missing@example.com'), null);
  });

  it('does not swallow a 5xx response that says not found', async () => {
    __setTestOverrides({ sleep: async () => {} });
    globalThis.fetch = async () =>
      new Response('Greenhouse user not found', { status: 500 });

    await assert.rejects(
      getUserByEmail('recruiter@example.com'),
      /Greenhouse API error 500 after 4 attempts/
    );
  });
});
