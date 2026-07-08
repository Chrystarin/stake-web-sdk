import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	getRgsErrorBalanceApiAmount,
	getRgsErrorStatusCode,
	isActiveRoundError,
	isInsufficientBalanceError,
	isRateLimitError,
} from './rgsError.ts';

// Mirrors the decision in createPrimaryMachines.handleRequestBet: an insufficient-balance
// rejection becomes the friendly "insufficient funds" message instead of the fatal error modal.
function modalForError(error: unknown): { name: string; message?: string } {
	return isInsufficientBalanceError(error)
		? { name: 'autoSpinMessage', message: 'insufficientFunds' }
		: { name: 'error' };
}

test('detects ERR_IPB from the `error` string field', () => {
	const err = { error: 'ERR_IPB', message: 'Insufficient Player Balance' };
	assert.equal(getRgsErrorStatusCode(err), 'ERR_IPB');
	assert.equal(isInsufficientBalanceError(err), true);
});

test('detects ERR_IPB from status.statusCode', () => {
	const err = { status: { statusCode: 'ERR_IPB', statusMessage: 'Insufficient Player Balance' } };
	assert.equal(isInsufficientBalanceError(err), true);
});

test('detects the reported ERR_IPBP variant', () => {
	assert.equal(isInsufficientBalanceError({ error: 'ERR_IPBP' }), true);
	assert.equal(isInsufficientBalanceError({ status: { statusCode: 'ERR_IPBP' } }), true);
});

test('detects message-only insufficient-balance payloads', () => {
	assert.equal(isInsufficientBalanceError({ message: 'insufficient balance for this bet' }), true);
	assert.equal(isInsufficientBalanceError('ERR_IPB: insufficient'), false); // string error, not object
});

test('does NOT misclassify unrelated RGS errors', () => {
	assert.equal(isInsufficientBalanceError({ error: 'ERR_VAL', message: 'active round' }), false);
	assert.equal(isInsufficientBalanceError({ status: { statusCode: 'ERR_BE' } }), false);
	assert.equal(isInsufficientBalanceError({ error: 'ERR_GE' }), false);
	assert.equal(isInsufficientBalanceError(undefined), false);
	assert.equal(isInsufficientBalanceError(null), false);
	assert.equal(isInsufficientBalanceError({}), false);
});

test('reads the authoritative balance carried on an error payload', () => {
	const err = { error: 'ERR_IPB', balance: { amount: 198_000_000 } };
	assert.equal(getRgsErrorBalanceApiAmount(err), 198_000_000);
	assert.equal(getRgsErrorBalanceApiAmount({ error: 'ERR_IPB' }), undefined);
	assert.equal(getRgsErrorBalanceApiAmount({ balance: { amount: Number.NaN } }), undefined);
});

test('detects rate-limit (429) from the rgsFetcher wrapper and plain-text bodies', () => {
	// The exact shape rgsFetcher builds for a non-JSON 429 body ("Too Many Requests").
	assert.equal(
		isRateLimitError({ error: 'ERR_RATE_LIMIT', httpStatus: 429, message: 'Too Many Requests' }),
		true,
	);
	assert.equal(isRateLimitError({ httpStatus: 429 }), true);
	assert.equal(isRateLimitError({ error: 'ERR_HTTP_429' }), true);
	assert.equal(isRateLimitError({ message: 'Too Many Requests' }), true);
	// Not a rate-limit error.
	assert.equal(isRateLimitError({ error: 'ERR_IPB' }), false);
	assert.equal(isRateLimitError({ httpStatus: 400 }), false);
	assert.equal(isRateLimitError({ error: 'ERR_VAL', message: 'active round' }), false);
	assert.equal(isRateLimitError(undefined), false);
});

test('detects the active-round conflict from various payload shapes', () => {
	assert.equal(isActiveRoundError({ error: 'ERR_VAL', message: 'player has an active round' }), true);
	assert.equal(isActiveRoundError({ status: { statusMessage: 'Active Round exists' } }), true);
	assert.equal(isActiveRoundError({ message: 'ACTIVE ROUND' }), true);
	// Not an active-round error.
	assert.equal(isActiveRoundError({ error: 'ERR_IPB', message: 'Insufficient Player Balance' }), false);
	assert.equal(isActiveRoundError({ error: 'ERR_RATE_LIMIT', httpStatus: 429 }), false);
	assert.equal(isActiveRoundError(undefined), false);
});

test('rate-limit and active-round are NOT misread as insufficient balance', () => {
	// These now route to the recoverable (non-fatal) branch in handleRequestBet, so they must not
	// collide with the insufficient-balance classifier.
	assert.equal(isInsufficientBalanceError({ error: 'ERR_RATE_LIMIT', httpStatus: 429 }), false);
	assert.equal(isInsufficientBalanceError({ error: 'ERR_VAL', message: 'active round' }), false);
});

test('insufficient balance routes to the friendly modal, other errors stay fatal', () => {
	// The exact gameplay scenario from the bug report: a high wager rejected mid-session.
	const ipb = { error: 'ERR_IPB', message: 'Insufficient Player Balance' };
	assert.deepEqual(modalForError(ipb), { name: 'autoSpinMessage', message: 'insufficientFunds' });

	const generic = { error: 'ERR_UE', message: 'Unknown Error' };
	assert.deepEqual(modalForError(generic), { name: 'error' });
});
