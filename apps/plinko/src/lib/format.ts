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

export const formatAmount = (value: number, currency = ''): string => {
	const formatted = value.toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	return currency ? `${currency}${formatted}` : formatted;
};
