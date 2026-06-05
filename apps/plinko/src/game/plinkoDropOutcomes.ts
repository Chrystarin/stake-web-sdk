import type { PlinkoBallOutcome } from './typesBookEvent';

/** Match UI balls-per-drop when lookup books were generated with a different count. */
export function resizePlinkoDropOutcomes(
	source: PlinkoBallOutcome[],
	targetCount: number,
): PlinkoBallOutcome[] {
	const n = Math.max(1, Math.floor(targetCount || 1));
	if (!source.length) return [];
	if (source.length === n) return source;
	if (source.length > n) return source.slice(0, n);
	return Array.from({ length: n }, (_, i) => source[i % source.length]);
}
