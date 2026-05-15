const SLOT_COLORS = [
	'#da3dbe',
	'#fb6287',
	'#f96f65',
	'#f58f61',
	'#feae62',
	'#fbcb67',
	'#fee663',
	'#21a7d9',
];

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

export function slotColorForMultiplier(coefficients: number[], multiplier: number): string {
	const index = coefficients.indexOf(multiplier);
	if (index === -1) return '#64748b';
	const mid = (coefficients.length - 1) / 2;
	const maxDist = Math.max(1, mid);
	const distFromCenter = Math.abs(index - mid);
	const t = 1 - Math.min(1, distFromCenter / maxDist);
	const scaled = t * (SLOT_COLORS.length - 1);
	const low = Math.floor(scaled);
	const high = Math.min(SLOT_COLORS.length - 1, low + 1);
	return interpolateHex(SLOT_COLORS[low], SLOT_COLORS[high], scaled - low);
}
