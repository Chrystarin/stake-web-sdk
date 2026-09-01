/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TEMPORARY dev-only on-screen audio state overlay (?audioDebug=1).
 *
 * BrowserStack's iOS DevTools are plan-gated, so the only way to read audio state off a real
 * device is to draw it on the page. Shows Howler / AudioContext state, whether the context
 * clock is actually advancing (a "running" context whose clock is frozen is the iOS zombie
 * state), and a rolling log of every audio-relevant event.
 *
 * DELETE (or leave query-gated) once the iOS audio bugs are verified fixed.
 */
import { Howl, Howler } from 'howler';

type AnyHowl = Howl & {
	_src?: string | string[];
	_emit?: (event: string, id?: number, msg?: unknown) => unknown;
};

const MAX_LOG = 14;

function basename(src: unknown): string {
	const s = Array.isArray(src) ? src[0] : src;
	if (typeof s !== 'string') return '?';
	const q = s.split('?')[0];
	return q.slice(q.lastIndexOf('/') + 1);
}

export function installAudioDebugOverlay(): () => void {
	if (typeof document === 'undefined') return () => {};

	const box = document.createElement('pre');
	box.style.cssText = [
		'position:fixed',
		'top:0',
		'left:0',
		'z-index:2147483647',
		'margin:0',
		'padding:4px 6px',
		'max-width:96vw',
		'font:9px/1.35 monospace',
		'color:#0f0',
		'background:rgba(0,0,0,0.72)',
		'pointer-events:none',
		'white-space:pre-wrap',
		'word-break:break-all',
	].join(';');
	document.body.appendChild(box);

	const log: string[] = [];
	const t0 = Date.now();
	const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
	let lastLine = '';
	let repeat = 0;
	function push(line: string) {
		if (line === lastLine) {
			repeat += 1;
			log[log.length - 1] = `${stamp()} ${line} x${repeat + 1}`;
			return;
		}
		lastLine = line;
		repeat = 0;
		log.push(`${stamp()} ${line}`);
		if (log.length > MAX_LOG) log.shift();
	}

	const howler = Howler as any;

	// ── Event taps ────────────────────────────────────────────────────────────
	// One prototype patch catches every Howl in the app (SFX and music alike).
	const proto = Howl.prototype as any;
	const origEmit = proto._emit;
	proto._emit = function (event: string, id?: number, msg?: unknown) {
		if (event === 'playerror' || event === 'loaderror' || event === 'unlock' || event === 'resume') {
			push(`${event}: ${basename(this._src)} ${msg ? String(msg).slice(0, 90) : ''}`);
		}
		return origEmit.call(this, event, id, msg);
	};
	const origPlay = proto.play;
	proto.play = function (...args: unknown[]) {
		const name = basename(this._src);
		// The peg/pocket spam would wash everything else out of the log.
		if (!/peg|pocket/.test(name)) {
			push(
				`play(${name}) H=${howler.state ?? '-'} ctx=${howler.ctx?.state ?? '-'} webAudio=${this._webAudio ? 1 : 0}`,
			);
		}
		return origPlay.apply(this, args);
	};

	// ── Recovery experiment buttons ───────────────────────────────────────────
	// Each tries one candidate fix against the live zombie state, so the recovery that actually
	// works on-device can be measured (clock ADVANCING again) instead of guessed.
	const bar = document.createElement('div');
	bar.style.cssText =
		'position:fixed;top:0;right:0;z-index:2147483647;display:flex;gap:4px;padding:4px;';
	function addButton(label: string, onTap: () => void) {
		const b = document.createElement('button');
		b.textContent = label;
		b.style.cssText =
			'font:11px monospace;padding:6px 8px;background:#032;color:#0f0;border:1px solid #0f0;border-radius:4px;';
		b.addEventListener('click', () => {
			push(`[${label}]`);
			try {
				onTap();
			} catch (err) {
				push(`[${label}] threw: ${String(err).slice(0, 80)}`);
			}
		});
		bar.appendChild(b);
	}
	addButton('S+R', () => {
		const ctx: AudioContext | undefined = howler.ctx;
		if (!ctx) return push('[S+R] no ctx');
		void ctx
			.suspend()
			.then(() => push(`[S+R] suspended (${ctx.state})`))
			.then(() => ctx.resume())
			.then(() => push(`[S+R] resumed (${ctx.state})`))
			.catch((e) => push(`[S+R] reject: ${String(e).slice(0, 80)}`));
	});
	addButton('KICK', () => {
		// html5 <audio> play to reactivate the media session, then resume the ctx.
		const a = new Audio('/sound/peg.wav');
		a.volume = 0.3;
		a.play()
			.then(() => push('[KICK] html5 play ok'))
			.catch((e) => push(`[KICK] html5 reject: ${String(e).slice(0, 80)}`));
		void howler.ctx?.resume().then(() => push(`[KICK] ctx resumed (${howler.ctx?.state})`));
	});
	addButton('NEW', () => {
		// Does a FRESH context render while the old one is frozen?
		const AC: typeof AudioContext =
			(window as any).AudioContext || (window as any).webkitAudioContext;
		const t = new AC();
		void t.resume();
		const osc = t.createOscillator();
		const g = t.createGain();
		g.gain.value = 0.05;
		osc.frequency.value = 440;
		osc.connect(g).connect(t.destination);
		osc.start();
		osc.stop(t.currentTime + 0.4);
		setTimeout(() => {
			push(`[NEW] state=${t.state} t=${t.currentTime.toFixed(2)} ${t.currentTime > 0 ? 'LIVE' : 'DEAD'}`);
			void t.close();
		}, 1200);
	});
	document.body.appendChild(bar);

	const onVis = () => push(`visibility=${document.visibilityState} ctx=${howler.ctx?.state ?? '-'}`);
	const onHide = () => push(`pagehide ctx=${howler.ctx?.state ?? '-'}`);
	const onShow = () => push(`pageshow ctx=${howler.ctx?.state ?? '-'}`);
	const onGesture = () => push(`tap H=${howler.state ?? '-'} ctx=${howler.ctx?.state ?? '-'}`);
	document.addEventListener('visibilitychange', onVis);
	window.addEventListener('pagehide', onHide);
	window.addEventListener('pageshow', onShow);
	document.addEventListener('touchend', onGesture, { capture: true, passive: true });
	document.addEventListener('click', onGesture, { capture: true, passive: true });

	let statechangeHooked: AudioContext | undefined;

	// ── Status panel ──────────────────────────────────────────────────────────
	let prevCtxTime = -1;
	let prevWall = 0;
	const timer = setInterval(() => {
		const ctx: AudioContext | undefined = howler.ctx;
		if (ctx && ctx !== statechangeHooked) {
			statechangeHooked = ctx;
			ctx.addEventListener('statechange', () => push(`ctx.statechange → ${ctx.state}`));
		}
		const now = performance.now();
		let advancing = '-';
		if (ctx) {
			if (prevCtxTime >= 0 && now - prevWall > 400) {
				advancing = ctx.currentTime > prevCtxTime ? 'ADVANCING' : 'FROZEN';
			}
			prevCtxTime = ctx.currentTime;
			prevWall = now;
		}
		const activation = (navigator as any).userActivation;
		const audioSession = (navigator as any).audioSession;
		// The two html5 music tracks live in EnableMusic, not sound.ts — find them by src and report
		// whether their <audio> node is actually advancing (the only way to see if BGM really plays).
		const musicLine = ((howler._howls ?? []) as any[])
			.filter((h) => /background_music/.test(String(h._src)))
			.map((h) => {
				const n = h._sounds?.[0]?._node;
				return `${basename(h._src).slice(0, 20)}: st=${h._state} play=${h.playing() ? 1 : 0}${
					n && typeof n.currentTime === 'number'
						? ` nT=${n.currentTime.toFixed(1)} paused=${n.paused ? 1 : 0} vol=${(n.volume ?? -1).toFixed(2)}`
						: ''
				}`;
			})
			.join('  |  ');
		const lines = [
			`ua: ${navigator.userAgent.slice(-60)}`,
			`Howler: webAudio=${howler.usingWebAudio ? 1 : 0} noAudio=${howler.noAudio ? 1 : 0} state=${howler.state ?? '-'} unlocked=${howler._audioUnlocked ? 1 : 0} pool=${howler._html5AudioPool?.length ?? '-'}`,
			`ctx: ${ctx ? `${ctx.state} sr=${ctx.sampleRate} t=${ctx.currentTime.toFixed(2)} ${advancing}` : 'none'}`,
			`activation: ${activation ? `active=${activation.hasBeenActive ? 1 : 0}` : 'n/a'}  audioSession: ${audioSession ? `${audioSession.type}/${audioSession.state}` : 'n/a'}`,
			`music: ${musicLine || 'none'}`,
			'── events ──',
			...log,
		];
		box.textContent = lines.join('\n');
	}, 500);

	return () => {
		clearInterval(timer);
		document.removeEventListener('visibilitychange', onVis);
		window.removeEventListener('pagehide', onHide);
		window.removeEventListener('pageshow', onShow);
		document.removeEventListener('touchend', onGesture, { capture: true } as any);
		document.removeEventListener('click', onGesture, { capture: true } as any);
		proto._emit = origEmit;
		proto.play = origPlay;
		bar.remove();
		box.remove();
	};
}
