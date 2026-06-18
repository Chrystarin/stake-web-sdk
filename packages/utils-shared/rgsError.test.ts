import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	getRgsErrorBalanceApiAmount,
	getRgsErrorStatusCode,
	isInsufficientBalanceError,
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

test('insufficient balance routes to the friendly modal, other errors stay fatal', () => {
	// The exact gameplay scenario from the bug report: a high wager rejected mid-session.
	const ipb = { error: 'ERR_IPB', message: 'Insufficient Player Balance' };
	assert.deepEqual(modalForError(ipb), { name: 'autoSpinMessage', message: 'insufficientFunds' });

	const generic = { error: 'ERR_UE', message: 'Unknown Error' };
	assert.deepEqual(modalForError(generic), { name: 'error' });
});
