/**
 * DEV-ONLY bonus-meter write tracer.
 *
 * The bonus bar has many writers (book events, the provisional peg-hit fill, the per-tier re-seed, the
 * session-store restore, the in-bonus level meter, the bonus award snap). When the bar shows a value no
 * book justifies, the only reliable way to find the culprit is to record every write with its stack.
 *
 * Zero cost unless armed: `window.plinkoTraceMeter(true)` turns it on, `plinkoTraceMeterDump()` reads it
 * back. Compiled out entirely in production (`import.meta.env.DEV`).
 */
import { stateGame } from './stateGame.svelte';

export type BonusMeterWrite = {
	where: string;
	from: number;
	to: number;
	max: number;
	dropRoundActive: boolean;
	bonusRoundActive: boolean;
	stack: string;
};

let armed = false;
const writes: BonusMeterWrite[] = [];
const MAX_WRITES = 400;

/** Record a pending write to `stateGame.bonusMeterValue`. Call immediately BEFORE the assignment. */
export function traceBonusMeterWrite(where: string, to: number): void {
	if (!import.meta.env.DEV || !armed) return;
	const from = stateGame.bonusMeterValue;
	// Only interesting when the value actually moves.
	if (from === to) return;
	const stack = (new Error().stack ?? '')
		.split('\n')
		.slice(2, 7)
		.map((line) => line.trim().replace(/^at\s+/, '').replace(/\?t=\d+/g, ''))
		.join(' <- ');
	writes.push({
		where,
		from,
		to,
		max: stateGame.bonusMeterMax,
		dropRoundActive: stateGame.dropRoundActive,
		bonusRoundActive: stateGame.bonusRoundActive,
		stack,
	});
	if (writes.length > MAX_WRITES) writes.shift();
}

/** Record a write that has ALREADY happened (e.g. inside meterController), given the prior value. */
export function traceBonusMeterWriteAfter(where: string, from: number): void {
	if (!import.meta.env.DEV || !armed) return;
	const to = stateGame.bonusMeterValue;
	if (from === to) return;
	const stack = (new Error().stack ?? '')
		.split('\n')
		.slice(2, 7)
		.map((line) => line.trim().replace(/^at\s+/, '').replace(/\?t=\d+/g, ''))
		.join(' <- ');
	writes.push({
		where,
		from,
		to,
		max: stateGame.bonusMeterMax,
		dropRoundActive: stateGame.dropRoundActive,
		bonusRoundActive: stateGame.bonusRoundActive,
		stack,
	});
	if (writes.length > MAX_WRITES) writes.shift();
}

export function installPlinkoMeterTrace(): void {
	if (!import.meta.env.DEV) return;
	const w = window as Window & {
		plinkoTraceMeter?: (on?: boolean) => string;
		plinkoTraceMeterDump?: (onlyAtMax?: boolean) => BonusMeterWrite[];
	};
	w.plinkoTraceMeter = (on = true) => {
		armed = on;
		writes.length = 0;
		return armed ? 'bonus meter trace ARMED' : 'bonus meter trace off';
	};
	w.plinkoTraceMeterDump = (onlyAtMax = false) =>
		onlyAtMax ? writes.filter((entry) => entry.max > 0 && entry.to >= entry.max) : [...writes];
}
