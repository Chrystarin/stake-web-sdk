/** Center (0.7×) → edge (25×) multiplier slot colors. */
export const SLOT_MULTIPLIER_COLORS = [
	'#52FF82',
	'#EDFC42',
	'#EEFF37',
	'#FFB801',
	'#FF5700',
	'#FF4B84',
	'#CC2A88',
] as const;

function interpolateHex(a: string, b: string, t: number): string {
	const parse = (hex: string) => {
		const h = hex.replace('#', '');
		return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
	};
	const [ar, ag, ab] = parse(a);
	const [br, bg, bb] = parse(b);
	const r = Math.round(ar + (br - ar) * t);
	const g = Math.round(ag + (bg - ag) * t);
	const bl = Math.round(ab + (bb - ab) * t);
	return `rgb(${r},${g},${bl})`;
}

function slotColorForIndex(coefficients: number[], index: number): string {
	if (index < 0 || index >= coefficients.length) return '#64748b';
	const mid = (coefficients.length - 1) / 2;
	const maxDist = Math.max(1, mid);
	const distFromCenter = Math.abs(index - mid);
	const centerToEdgeT = Math.min(1, distFromCenter / maxDist);
	const scaled = centerToEdgeT * (SLOT_MULTIPLIER_COLORS.length - 1);
	const low = Math.floor(scaled);
	const high = Math.min(SLOT_MULTIPLIER_COLORS.length - 1, low + 1);
	return interpolateHex(SLOT_MULTIPLIER_COLORS[low], SLOT_MULTIPLIER_COLORS[high], scaled - low);
}

export function slotColorForRateIndex(coefficients: number[], rateIndex: number): string {
	return slotColorForIndex(coefficients, rateIndex);
}

export function slotColorForMultiplier(coefficients: number[], multiplier: number): string {
	const index = coefficients.indexOf(multiplier);
	return slotColorForIndex(coefficients, index);
}
