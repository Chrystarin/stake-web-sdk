import { stateBet } from 'state-shared';

/**
 * How money is written, per Stake's currency table
 * (https://stake-engine.com/docs/rgs, "Supported Currencies"): each currency has its own symbol,
 * its own number of decimals, and its symbol before or after the figure. Reviewers load the game
 * in several of these, and a yen balance with cents on it is sent back.
 *
 * Every amount the game prints goes through here. Chip faces and the Buy Bonus chip stepper are
 * the exception: they name a denomination rather than state a sum, and stay abbreviated (1k).
 */
type CurrencyFormat = { symbol: string; decimals: number; symbolAfter?: boolean };

const CURRENCY_FORMAT: Record<string, CurrencyFormat> = {
	USD: { symbol: '$', decimals: 2 },
	CAD: { symbol: 'CA$', decimals: 2 },
	JPY: { symbol: '¥', decimals: 0 },
	EUR: { symbol: '€', decimals: 2 },
	RUB: { symbol: '₽', decimals: 2 },
	CNY: { symbol: 'CN¥', decimals: 2 },
	PHP: { symbol: '₱', decimals: 2 },
	INR: { symbol: '₹', decimals: 2 },
	IDR: { symbol: 'Rp', decimals: 0 },
	KRW: { symbol: '₩', decimals: 0 },
	BRL: { symbol: 'R$', decimals: 2 },
	MXN: { symbol: 'MX$', decimals: 2 },
	DKK: { symbol: 'KR', decimals: 2, symbolAfter: true },
	PLN: { symbol: 'zł', decimals: 2, symbolAfter: true },
	VND: { symbol: '₫', decimals: 0, symbolAfter: true },
	TRY: { symbol: '₺', decimals: 2 },
	CLP: { symbol: 'CLP', decimals: 0, symbolAfter: true },
	ARS: { symbol: 'ARS', decimals: 2, symbolAfter: true },
	PEN: { symbol: 'S/', decimals: 2, symbolAfter: true },
	NGN: { symbol: '₦', decimals: 2 },
	SAR: { symbol: 'SAR', decimals: 2, symbolAfter: true },
	ILS: { symbol: '₪', decimals: 2 },
	AED: { symbol: 'AED', decimals: 2, symbolAfter: true },
	TWD: { symbol: 'NT$', decimals: 2 },
	NOK: { symbol: 'kr', decimals: 2, symbolAfter: true },
	KWD: { symbol: 'KD', decimals: 3 },
	JOD: { symbol: 'JD', decimals: 3 },
	CRC: { symbol: '₡', decimals: 2 },
	TND: { symbol: 'TND', decimals: 3, symbolAfter: true },
	SGD: { symbol: 'SG$', decimals: 2 },
	MYR: { symbol: 'RM', decimals: 2 },
	OMR: { symbol: 'OMR', decimals: 3, symbolAfter: true },
	QAR: { symbol: 'QAR', decimals: 2, symbolAfter: true },
	BHD: { symbol: 'BD', decimals: 3 },
	PKR: { symbol: '₨', decimals: 2 },
	EGP: { symbol: 'ج.م', decimals: 2 },
	NZD: { symbol: 'NZ$', decimals: 2 },
	BOB: { symbol: 'Bs', decimals: 2 },
	GHS: { symbol: 'GH₵', decimals: 2 },
	KES: { symbol: 'KSh', decimals: 2 },
	MAD: { symbol: 'MAD', decimals: 2, symbolAfter: true },
	BAM: { symbol: 'KM', decimals: 2 },
	ISK: { symbol: 'kr', decimals: 0, symbolAfter: true },
	TZS: { symbol: 'TSh', decimals: 2 },
	UGX: { symbol: 'USh', decimals: 0 },
	XOF: { symbol: 'CFA', decimals: 0, symbolAfter: true },
	// Social casino coins (stake.us), as the approval guidelines' table writes them: "10.00 GC".
	// (Stake's sample code disagrees with its own table here; the table is what reviewers read.)
	XGC: { symbol: 'GC', decimals: 2, symbolAfter: true },
	XSC: { symbol: 'SC', decimals: 2, symbolAfter: true },
	XEC: { symbol: 'SC', decimals: 2, symbolAfter: true },
};

/** A currency Stake adds later still reads correctly: its own code, after the figure. */
const formatOf = (currency: string): CurrencyFormat =>
	CURRENCY_FORMAT[currency] ?? { symbol: currency, decimals: 2, symbolAfter: true };

/** The RGS counts money in millionths, so nothing finer than six places is real. */
const API_DECIMALS = 6;

/**
 * The fewest decimals, from the currency's own upward, that state `value` exactly. A 13.5x buy
 * on a 0.01 chip costs 0.135, and Stake wants the sum shown as it is, not as 0.14.
 */
const exactDecimals = (value: number, from: number): number => {
	const exact = Number(value.toFixed(API_DECIMALS));
	for (let decimals = from; decimals < API_DECIMALS; decimals++) {
		if (Number(exact.toFixed(decimals)) === exact) return decimals;
	}
	return API_DECIMALS;
};

const write = (value: number, decimals: number, { symbol, symbolAfter }: CurrencyFormat) => {
	// Western digits and separators whatever `lang` is: the figures are not translated, and a
	// locale's own numerals beside the game's fixed lettering read as a fault.
	const figure = value.toLocaleString('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	});
	return symbolAfter ? `${figure} ${symbol}` : `${symbol}${figure}`;
};

/** A sum in the session's currency, exact: a bet, a price, a win. Never abbreviated. */
export const formatMoney = (value: number, currency: string = stateBet.currency): string => {
	const format = formatOf(currency);
	const amount = Number.isFinite(value) ? value : 0;
	return write(amount, exactDecimals(amount, format.decimals), format);
};

/**
 * The balance: always at the currency's own decimals, which is all Stake asks of it. Cut, not
 * rounded, so a balance holding a fraction of a cent never reads as more than is there.
 */
export const formatBalance = (value: number, currency: string = stateBet.currency): string => {
	const format = formatOf(currency);
	const unit = 10 ** format.decimals;
	const amount = Number.isFinite(value) ? value : 0;
	// The nudge absorbs float noise (0.3 held as 0.29999999999999996) before the cut.
	const cut = Math.floor(Number((amount * unit).toFixed(API_DECIMALS - format.decimals))) / unit;
	return write(cut, format.decimals, format);
};
