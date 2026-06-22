export const isMobile = (): boolean =>
	/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
		typeof navigator !== 'undefined' ? navigator.userAgent : '',
	);

/** Mobile UA or tall narrow viewport (portrait reference layout 992×1761). */
export const isPortraitGameLayout = (): boolean => {
	if (isMobile()) return true;
	if (typeof window === 'undefined') return false;
	const w = window.innerWidth;
	const h = window.innerHeight;
	return h > w && w <= 820;
};

export const formatCoefficientLabel = (value: number): string => {
	if (value == null || Number.isNaN(value)) return '';
	if (value > 999_999) return `${(value / 1_000_000).toFixed(1)}m`;
	if (value > 999) return `${(value / 1_000).toFixed(1)}k`;
	return Number(value).toFixed(value % 1 === 0 ? 0 : 1);
};

/**
 * Compact bet-amount label: abbreviates 4-digit+ values (1000 → "1k", 1500 → "1.5k",
 * 1_000_000 → "1m", 2_500_000 → "2.5m") and drops a trailing `.00` (1.00 → "1", 0.10 → "0.1",
 * 0.01 → "0.01"). Up to 2 significant decimals are kept, with trailing zeros stripped.
 */
export const formatCompactAmount = (value: number): string => {
	if (value == null || Number.isNaN(value)) return '';
	// Round to `decimals`, then drop trailing zeros and any trailing decimal point.
	const trim = (n: number, decimals: number) => Number(n.toFixed(decimals)).toString();
	const abs = Math.abs(value);
	if (abs >= 1_000_000) return `${trim(value / 1_000_000, 2)}m`;
	if (abs >= 1_000) return `${trim(value / 1_000, 2)}k`;
	return trim(value, 2);
};

export const formatAmount = (value: number, currency = ''): string => {
	const formatted = value.toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	return currency ? `${currency}${formatted}` : formatted;
};

/** `HH:mm DD-MM-YY` — matches legacy Plinko bet history. */
export const formatHistoryDate = (date: Date): string => {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${String(date.getFullYear()).slice(-2)}`;
};

/** Board multiplier label (coefficients are canonical board values). */
export const formatHistoryMultiplier = (value: number): string => {
	const label = formatCoefficientLabel(value);
	return label ? `x${label}` : 'x0';
};
