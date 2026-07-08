import assert from 'node:assert/strict';
import { afterEach, before, mock, test } from 'node:test';

/** Minimal Response stand-in — rgsFetcher only reads `.status`, `.ok`, `.headers.get`, `.text()`. */
function fakeResponse(
	status: number,
	body: unknown,
	opts: { retryAfter?: string } = {},
): Response {
	const headers = new Map<string, string>();
	if (opts.retryAfter != null) headers.set('retry-after', opts.retryAfter);
	return {
		status,
		ok: status >= 200 && status < 300,
		statusText: '',
		url: 'https://rgs.test/wallet/play',
		headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
	} as unknown as Response;
}

let queued: Response[] = [];
let calls = 0;

// Mock `utils-fetcher` so the test drives rgsFetcher's retry/parse logic with controlled responses
// (and avoids resolving the real package's transpile-only internals under node --test).
mock.module('utils-fetcher', {
	namedExports: {
		fetcher: async () => {
			calls += 1;
			return queued[Math.min(calls - 1, queued.length - 1)];
		},
	},
});

let rgsFetcher: typeof import('./rgsFetcher.ts').rgsFetcher;
before(async () => {
	({ rgsFetcher } = await import('./rgsFetcher.ts'));
});

afterEach(() => {
	queued = [];
	calls = 0;
});

// The reported crash: a gateway 429 whose body is the plain text "Too Many Requests" (not JSON).
// The old code called `response.json()` on it and threw `SyntaxError: Unexpected token 'T'`, which
// bubbled up to the fatal error modal. It must now resolve to a structured error instead of throwing.
test('a non-JSON 429 body does not throw a SyntaxError', async () => {
	queued = [fakeResponse(429, 'Too Many Requests', { retryAfter: '0' })];
	const data = (await rgsFetcher.get({ rgsUrl: 'rgs.test', url: '/wallet/balance' as never })) as {
		error?: string;
		httpStatus?: number;
		message?: string;
	};
	assert.equal(data.httpStatus, 429);
	assert.equal(data.error, 'ERR_RATE_LIMIT');
	assert.match(String(data.message), /Too Many Requests/);
});

test('retries a 429 and succeeds when the next attempt returns JSON', async () => {
	queued = [
		fakeResponse(429, 'Too Many Requests', { retryAfter: '0' }),
		fakeResponse(429, 'Too Many Requests', { retryAfter: '0' }),
		fakeResponse(200, { round: { state: [1] }, balance: { amount: 500 } }),
	];
	const data = (await rgsFetcher.post({
		rgsUrl: 'rgs.test',
		url: '/wallet/play' as never,
	})) as { balance?: { amount: number } };
	assert.equal(data.balance?.amount, 500);
	assert.equal(calls, 3); // two 429s retried, third succeeds
});

test('gives up after the retry cap and returns a structured (non-throwing) rate-limit error', async () => {
	queued = [fakeResponse(429, 'Too Many Requests', { retryAfter: '0' })];
	const data = (await rgsFetcher.post({
		rgsUrl: 'rgs.test',
		url: '/wallet/play' as never,
	})) as { error?: string; httpStatus?: number };
	assert.equal(data.error, 'ERR_RATE_LIMIT');
	assert.equal(data.httpStatus, 429);
	assert.equal(calls, 5); // initial + 4 retries (RATE_LIMIT_MAX_RETRIES)
});

test('a normal JSON error body (HTTP 200) is returned unchanged (contract preserved)', async () => {
	queued = [fakeResponse(200, { error: 'ERR_VAL', message: 'player has an active round' })];
	const data = (await rgsFetcher.post({
		rgsUrl: 'rgs.test',
		url: '/wallet/play' as never,
	})) as { error?: string; message?: string };
	assert.equal(data.error, 'ERR_VAL');
	assert.match(String(data.message), /active round/);
});

test('a successful JSON response is parsed and returned', async () => {
	queued = [fakeResponse(200, { round: { state: [1, 2] }, balance: { amount: 42 } })];
	const data = (await rgsFetcher.post({
		rgsUrl: 'rgs.test',
		url: '/wallet/play' as never,
	})) as { round?: { state: number[] } };
	assert.deepEqual(data.round?.state, [1, 2]);
});
