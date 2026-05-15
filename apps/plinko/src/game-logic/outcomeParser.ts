import type { PlinkoBallOutcome } from '../game/typesBookEvent';

/**
 * Maps a server value to `{ rateIndex, multiplier }`.
 * Integers in slot-index range are treated as pocket indices; otherwise matched as multipliers.
 */
export const interpretAsSlotIndex = (
	value: number,
	coefficients: number[],
): { rateIndex: number; multiplier: number } | null => {
	if (!coefficients.length) return null;
	if (Number.isInteger(value) && value >= 0 && value < coefficients.length) {
		return { rateIndex: value, multiplier: coefficients[value] };
	}
	if (Number.isInteger(value) && value >= 1 && value <= coefficients.length) {
		const i = value - 1;
		return { rateIndex: i, multiplier: coefficients[i] };
	}
	return null;
};

const resolveRateIndex = (multiplier: number, coefficients: number[]): number => {
	const exact = coefficients.indexOf(multiplier);
	if (exact >= 0) return exact;
	let best = -1;
	let bestDiff = Infinity;
	coefficients.forEach((c, i) => {
		const diff = Math.abs(c - multiplier);
		if (diff < bestDiff) {
			bestDiff = diff;
			best = i;
		}
	});
	return best;
};

export const interpretRoundResultValue = (
	value: number,
	coefficients: number[],
): { rateIndex: number; multiplier: number } | null => {
	const asSlot = interpretAsSlotIndex(value, coefficients);
	if (asSlot) return asSlot;
	if (!coefficients.length) return null;
	const rateIndex = resolveRateIndex(value, coefficients);
	if (rateIndex >= 0) return { rateIndex, multiplier: coefficients[rateIndex] };
	return null;
};

const extractNumericFromRoundResultItem = (item: unknown): number | null => {
	if (item == null) return null;
	if (typeof item === 'number' && Number.isFinite(item)) return item;
	if (typeof item === 'string') {
		const n = Number(item);
		return Number.isFinite(n) ? n : null;
	}
	if (typeof item === 'object' && !Array.isArray(item)) {
		const obj = item as Record<string, unknown>;
		const state = obj.state as Record<string, unknown> | undefined;
		const candidates = [
			obj.slotIndex,
			obj.slot,
			obj.index,
			obj.targetIndex,
			obj.bin,
			obj.resultValue,
			obj.multiplier,
			obj.Multiplier,
			obj.payoutMultiplier,
			obj.result,
			obj.value,
			state?.multiplier,
			(state as Record<string, unknown> | undefined)?.Multiplier,
		];
		for (const c of candidates) {
			const n = Number(c);
			if (Number.isFinite(n)) return n;
		}
	}
	return null;
};

export const parseSingleRoundResultItem = (
	item: unknown,
	coefficients: number[],
): { rateIndex: number; multiplier: number } | null => {
	if (item != null && typeof item === 'object' && !Array.isArray(item)) {
		const obj = item as Record<string, unknown>;
		const explicit = Number(
			obj.slotIndex ?? obj.slot ?? obj.index ?? obj.targetIndex ?? obj.bin ?? obj.resultValue,
		);
		if (Number.isInteger(explicit)) {
			const slot = interpretAsSlotIndex(explicit, coefficients);
			if (slot) return slot;
		}
	}
	const v = extractNumericFromRoundResultItem(item);
	if (v == null || !Number.isFinite(v)) return null;
	return interpretRoundResultValue(v, coefficients);
};

/** Extract per-ball outcomes from a Stake round `state` object or book-event payload. */
export const extractBallOutcomes = (
	payload: unknown,
	coefficients: number[],
	expectedRounds: number,
	stakePerBall: number,
): PlinkoBallOutcome[] => {
	const state =
		payload && typeof payload === 'object' && !Array.isArray(payload)
			? (payload as Record<string, unknown>)
			: {};
	const results = Array.isArray(state.results)
		? state.results
		: Array.isArray((payload as { results?: unknown[] })?.results)
			? (payload as { results: unknown[] }).results
			: [];

	const outcomes: PlinkoBallOutcome[] = [];
	const count = Math.max(expectedRounds, results.length);

	for (let i = 0; i < count; i++) {
		const parsed = parseSingleRoundResultItem(results[i], coefficients);
		if (parsed) {
			outcomes.push({
				rateIndex: parsed.rateIndex,
				multiplier: parsed.multiplier,
				amount: stakePerBall,
			});
		}
	}

	if (!outcomes.length && state.multiplier != null) {
		const agg = Number(state.multiplier);
		if (Number.isFinite(agg) && agg > 0) {
			const parsed = interpretRoundResultValue(agg, coefficients);
			if (parsed) {
				outcomes.push({
					rateIndex: parsed.rateIndex,
					multiplier: parsed.multiplier,
					amount: stakePerBall,
				});
			}
		}
	}

	return outcomes;
};
