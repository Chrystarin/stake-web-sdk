<script lang="ts">
	/**
	 * What the player sees when the RGS says no.
	 *
	 * The shared packages report every failure by setting `stateModal.modal`: `Authenticate` for a
	 * failed `/wallet/authenticate` or `/bet/replay`, `createPrimaryMachines` for a refused
	 * `/wallet/play`. Nothing in this app read it, so a bad `rgs_url`, an expired session or a
	 * maintenance window left the player on a table that silently did nothing. Stake's reviewers
	 * launch the game with an invalid `rgs_url` and expect a connection or authentication error on
	 * screen (approval guidelines, "RGS communication").
	 *
	 * The codes are the wallet API's: ERR_VAL (bad session, bad amount, unknown mode), ERR_IPB
	 * (balance), ERR_GLE (gambling limit), ERR_ACT (429, slow down), ERR_GEN (500), and a bare
	 * HTTP 423 on /wallet/play while bets are paused. A `TypeError` is the fetch itself failing:
	 * no such host, or no connection.
	 *
	 * "Fatal" notices only offer RELOAD: the session is gone, or there never was one. The rest can be
	 * closed and the table used again.
	 */
	import { stateConfig, stateModal } from 'state-shared';
	import {
		getRgsErrorStatusCode,
		isInsufficientBalanceError,
		isRateLimitError,
	} from 'utils-shared/rgsError';

	import { playSound } from '../game/sound';

	type Notice = { title: string; body: string; detail?: string; fatal: boolean };

	type ErrorLike = { message?: unknown; httpStatus?: unknown };

	const messageOf = (error: unknown): string => {
		if (error instanceof Error) return error.message;
		const message = (error as ErrorLike | null)?.message;
		return typeof message === 'string' ? message : '';
	};

	const httpStatusOf = (error: unknown): number => {
		const status = (error as ErrorLike | null)?.httpStatus;
		return typeof status === 'number' ? status : 0;
	};

	/**
	 * The session never came up, so there is nothing to go back to. `betAmountOptions` is no
	 * signal (it ships with a default grid): a successful authenticate is what sets `minBet` and
	 * `defaultBetLevel`, and the dev harness sets both too.
	 */
	const noSession = () => stateConfig.minBet === 0 && stateConfig.defaultBetLevel === 0;

	const describe = (error: unknown): Notice => {
		const code = getRgsErrorStatusCode(error);
		const message = messageOf(error);
		const lower = message.toLowerCase();
		const http = httpStatusOf(error);

		// The request never got an answer: an unreachable host, DNS, or no connection at all.
		if (error instanceof TypeError || (!code && error instanceof Error)) {
			return {
				title: 'Connection problem',
				body: 'The game could not reach its server. Check your connection and reload the game.',
				detail: message,
				fatal: true,
			};
		}
		if (isInsufficientBalanceError(error)) {
			return {
				title: 'Not enough balance',
				body: 'Your balance does not cover this bet. Lower the chip or take some spots off the board.',
				fatal: false,
			};
		}
		if (code.startsWith('ERR_GLE')) {
			return {
				title: 'Limit reached',
				body: 'A gambling limit on your account stops this bet.',
				detail: message,
				fatal: false,
			};
		}
		if (isRateLimitError(error) || code.startsWith('ERR_ACT')) {
			return {
				title: 'Please slow down',
				body: 'The server is busy. Wait a moment and try again.',
				fatal: false,
			};
		}
		if (http === 423 || lower.includes('paused') || lower.includes('maintenance')) {
			return {
				title: 'Bets are paused',
				body: 'New bets are paused for the moment. Please try again later.',
				detail: message,
				fatal: false,
			};
		}
		if (code.startsWith('ERR_VAL') && (lower.includes('session') || noSession())) {
			return {
				title: 'Session problem',
				body: 'Your session is not valid any more. Reload the game to start a new one.',
				detail: message || code,
				fatal: true,
			};
		}
		if (code.startsWith('ERR_VAL')) {
			return {
				title: 'Bet refused',
				body: 'The server did not accept this bet.',
				detail: message || code,
				fatal: false,
			};
		}
		return {
			title: 'Something went wrong',
			body: 'The game server reported a problem. Reload the game and try again.',
			detail: [code, message].filter(Boolean).join(' ') || undefined,
			fatal: noSession(),
		};
	};

	const notice = $derived.by((): Notice | null => {
		const modal = stateModal.modal;
		if (!modal) return null;
		if (modal.name === 'error') return describe(modal.error);
		if (modal.name === 'autoSpinMessage') {
			if (modal.message === 'insufficientFunds') {
				return {
					title: 'Not enough balance',
					body: 'Your balance does not cover this bet. Lower the chip or take some spots off the board.',
					fatal: false,
				};
			}
			return {
				title: 'Bet stopped',
				body: 'A limit on your account stopped this bet.',
				fatal: false,
			};
		}
		return null;
	});

	const close = () => {
		playSound('click');
		stateModal.modal = null;
	};

	const reload = () => {
		window.location.reload();
	};
</script>

{#if notice}
	<div class="rgs-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="rgs-notice-title">
		<div class="rgs-panel">
			<h2 id="rgs-notice-title" class="rgs-title">{notice.title}</h2>
			<p class="rgs-body">{notice.body}</p>
			{#if notice.detail}
				<p class="rgs-detail">{notice.detail}</p>
			{/if}
			<div class="rgs-actions">
				{#if !notice.fatal}
					<button type="button" class="rgs-btn" onclick={close}>Close</button>
				{/if}
				<button type="button" class="rgs-btn rgs-btn--primary" onclick={reload}>Reload</button>
			</div>
		</div>
	</div>
{/if}

<style lang="scss">
	/* Above the quick guide and the info modal (18500): a dead session outranks a walkthrough. */
	.rgs-backdrop {
		position: fixed;
		inset: 0;
		z-index: 19000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4vw;
		box-sizing: border-box;
		background: rgba(4, 8, 16, 0.78);
		font-family: 'Alexandria', sans-serif;
	}
	/* Sized in clamps so the same panel reads in the Popout S mini-player (400x225) and full screen. */
	.rgs-panel {
		width: min(86vw, 34rem);
		max-height: 92vh;
		overflow: auto;
		box-sizing: border-box;
		padding: clamp(0.7rem, 2.4vw, 1.6rem) clamp(0.9rem, 3vw, 2rem);
		border-radius: clamp(0.5rem, 1vw, 0.9rem);
		border: 2px solid #ffe14d;
		background: linear-gradient(180deg, #1c2a44 0%, #0d1526 100%);
		box-shadow: 0 1vw 3vw rgba(0, 0, 0, 0.6);
		color: #fff;
		text-align: center;
	}
	.rgs-title {
		margin: 0 0 0.5em;
		font-size: clamp(0.9rem, 2.2vw, 1.5rem);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #ffe14d;
	}
	.rgs-body {
		margin: 0;
		font-size: clamp(0.7rem, 1.5vw, 1rem);
		line-height: 1.45;
	}
	.rgs-detail {
		margin: 0.6em 0 0;
		font-size: clamp(0.6rem, 1.1vw, 0.8rem);
		color: rgba(255, 255, 255, 0.6);
		word-break: break-word;
	}
	.rgs-actions {
		display: flex;
		gap: 0.8em;
		justify-content: center;
		margin-top: clamp(0.7rem, 2vw, 1.3rem);
	}
	.rgs-btn {
		min-width: 7em;
		padding: 0.55em 1.4em;
		border-radius: 999px;
		border: 2px solid #ffe14d;
		background: transparent;
		color: #ffe14d;
		font: inherit;
		font-size: clamp(0.7rem, 1.4vw, 0.95rem);
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		cursor: pointer;
		transition: transform 0.12s ease;
	}
	.rgs-btn--primary {
		background: #ffe14d;
		color: #1a1a1a;
	}
	.rgs-btn:hover {
		transform: scale(1.04);
	}
	.rgs-btn:active {
		transform: scale(0.97);
	}
</style>
