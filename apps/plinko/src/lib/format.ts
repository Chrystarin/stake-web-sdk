export const isMobile = (): boolean =>
	/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
		typeof navigator !== 'undefined' ? navigator.userAgent : '',
	);

/**
 * True when the device has touch hardware. Unlike the user agent and the layout viewport width,
 * `maxTouchPoints` is NOT spoofed by Chrome's "Desktop site" toggle — a physical phone still reports
 * touch points there — so it's the reliable signal for "this is really a handheld device".
 */
const isTouchDevice = (): boolean => {
	if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
	if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
		return window.matchMedia('(any-pointer: coarse)').matches;
	}
	return false;
};

/** Mobile UA or tall narrow viewport (portrait reference layout 992×1761). */
export const isPortraitGameLayout = (): boolean => {
	// No window (SSR): fall back to the UA sniff.
	if (typeof window === 'undefined') return isMobile();
	const w = window.innerWidth;
	const h = window.innerHeight;
	// Orientation first: a square or landscape viewport (width ≥ height) always uses the
	// desktop/landscape layout — even a phone held sideways. Only a taller-than-wide viewport is
	// eligible for the portrait layout. This is checked before the UA sniff so rotating a phone into
	// landscape actually switches layouts instead of being pinned to portrait by `isMobile()`.
	if (w >= h) return false;
	// Portrait viewport (h > w) below.
	if (isMobile()) return true;
	// A physical phone with Chrome "Desktop site" enabled spoofs a desktop UA and inflates the layout
	// viewport to ~980px, so both `isMobile()` and the `w <= 820` cap below miss and the game wrongly
	// falls back to the desktop layout. Touch hardware isn't spoofed, so treat any touch device in
	// portrait as the portrait/mobile layout.
	if (isTouchDevice()) return true;
	// Non-touch desktop in a narrow portrait window.
	return w <= 820;
};

/**
 * Board-pocket label. This is what the player READS off the pocket they are about to be paid from
 * (`PlinkoEngine` slot `labelText`), so it must not round a value away: it keeps up to TWO decimals and
 * drops trailing zeros — 100 → "100", 1.5 → "1.5", 0.25 → "0.25", 0.2 → "0.2", 0 → "0".
 *
 * ⚠️ No shipped pocket needs the second decimal today — this is a guard. Under the previous one-decimal
 * rule a 0.25× pocket printed as "0.3", i.e. labelled 20% above what it pays, and a 0.25× pocket was a
 * live candidate while the 1-ball board was being re-cut. Every value either rule can render comes out
 * identical, so the guard costs nothing.
 * `alignCoefficientSet` matches server coefficients to board slots on these labels, so the two sides stay
 * consistent as long as both go through this function.
 */
export const formatCoefficientLabel = (value: number): string => {
	if (value == null || Number.isNaN(value)) return '';
	if (value > 999_999) return `${(value / 1_000_000).toFixed(1)}m`;
	if (value > 999) return `${(value / 1_000).toFixed(1)}k`;
	return String(Number(value.toFixed(2)));
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

/**
 * Fraction-digit config for win / payout amounts. Per spec these show up to 4 decimals: the
 * standard 2 decimals for normal wins, expanding as far as 4 so a tiny win on a low bet
 * (e.g. a 0.005 win on a $0.01 stake) is shown as `0.0050` instead of being rounded away to
 * `0.00`. Balances, bets and other currency values stay at 2 decimals (see `formatAmount`).
 */
export const WIN_FRACTION_DIGITS = {
	minimumFractionDigits: 2,
	maximumFractionDigits: 4,
} as const;

/**
 * Win-amount label for the result popup. Shows the standard 2 decimals, expanding up to 4 so a
 * tiny win that would round to `0.00` at 2 decimals (e.g. 0.0025 → `0.0025`) stays visible.
 */
export const formatResultAmount = (value: number): string => {
	if (value == null || Number.isNaN(value)) return '0.00';
	return value.toLocaleString('en-US', WIN_FRACTION_DIGITS);
};

/**
 * Social-casino currencies arrive from the RGS as `XSC` / `XGC`, but jurisdiction rules require
 * them to be shown as `SC` / `GC` (the leading `X` is dropped). These codes only ever appear in
 * Social Mode, so the remap is unconditional — every other currency is returned unchanged.
 */
const DISPLAY_CURRENCY_MAP: Record<string, string> = {
	XSC: 'SC',
	XGC: 'GC',
};

/** Player-facing currency code — remaps Social Mode `XSC`/`XGC` to `SC`/`GC`. */
export const displayCurrency = (currency: string): string =>
	DISPLAY_CURRENCY_MAP[currency] ?? currency;

/**
 * Currency prefix for amount labels: `$` for USD, otherwise the (display-remapped) currency code
 * followed by a space — e.g. `SC 1.00`. Use everywhere an amount is shown with its currency.
 */
export const currencySign = (currency: string): string =>
	currency === 'USD' ? '$' : `${displayCurrency(currency)} `;

/**
 * Fraction-digit config for the player's BALANCE. It keeps the usual 2 decimals, then expands to
 * as many as 4 — but only for the places that actually carry a digit: 1.5 → `1.50`, 1.234 →
 * `1.234`, 1.2345 → `1.2345`. `Intl` already drops trailing zeros above the minimum, so the
 * min/max pair is the whole rule.
 *
 * Balances can hold sub-cent dust (a fractional-coefficient win on a low stake), and rounding it
 * away at 2 decimals makes the balance look like it lost money on a win. Bets and other currency
 * values stay at 2 decimals — see `formatAmount`.
 */
export const BALANCE_FRACTION_DIGITS = {
	minimumFractionDigits: 2,
	maximumFractionDigits: 4,
} as const;

/**
 * Balance amount (2–4 decimals — see {@link BALANCE_FRACTION_DIGITS}). Use this instead of
 * `formatAmount` wherever the *balance* is shown.
 */
export const formatBalanceAmount = (value: number, currency = ''): string => {
	const n = value == null || Number.isNaN(value) ? 0 : value;
	const formatted = n.toLocaleString('en-US', BALANCE_FRACTION_DIGITS);
	return currency ? `${currency}${formatted}` : formatted;
};

/** Balance / bet amount (up to 2 decimals). */
export const formatAmount = (value: number, currency = ''): string => {
	const formatted = value.toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	return currency ? `${currency}${formatted}` : formatted;
};

/**
 * Win / payout amount (up to 4 decimals — see {@link WIN_FRACTION_DIGITS}). Use this instead of
 * `formatAmount` wherever a *win* is shown so small wins on low bets aren't rounded to `0.00`.
 */
export const formatWinAmount = (value: number, currency = ''): string => {
	const n = value == null || Number.isNaN(value) ? 0 : value;
	const formatted = n.toLocaleString('en-US', WIN_FRACTION_DIGITS);
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
