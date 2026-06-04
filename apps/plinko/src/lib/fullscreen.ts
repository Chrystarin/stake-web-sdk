import { browser } from '$app/environment';

type FullscreenDocument = Document & {
	webkitFullscreenElement?: Element | null;
	mozFullScreenElement?: Element | null;
	msFullscreenElement?: Element | null;
	webkitExitFullscreen?: () => Promise<void>;
	mozCancelFullScreen?: () => Promise<void>;
	msExitFullscreen?: () => Promise<void>;
};

type FullscreenElement = HTMLElement & {
	webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
	mozRequestFullScreen?: (options?: FullscreenOptions) => Promise<void>;
	msRequestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
};

export function getFullscreenElement(): Element | null {
	if (!browser) return null;
	const doc = document as FullscreenDocument;
	return (
		doc.fullscreenElement ??
		doc.webkitFullscreenElement ??
		doc.mozFullScreenElement ??
		doc.msFullscreenElement ??
		null
	);
}

export async function requestGameFullscreen(target: HTMLElement): Promise<void> {
	if (!browser) return;
	const el = target as FullscreenElement;
	const request =
		el.requestFullscreen?.bind(el) ??
		el.webkitRequestFullscreen?.bind(el) ??
		el.mozRequestFullScreen?.bind(el) ??
		el.msRequestFullscreen?.bind(el);
	if (!request) return;
	await request.call(el);
}

export async function exitGameFullscreen(): Promise<void> {
	if (!browser) return;
	const doc = document as FullscreenDocument;
	const exit =
		doc.exitFullscreen?.bind(doc) ??
		doc.webkitExitFullscreen?.bind(doc) ??
		doc.mozCancelFullScreen?.bind(doc) ??
		doc.msExitFullscreen?.bind(doc);
	if (!exit) return;
	await exit.call(doc);
}

export async function toggleGameFullscreen(target: HTMLElement): Promise<void> {
	if (getFullscreenElement()) {
		await exitGameFullscreen();
		return;
	}
	await requestGameFullscreen(target);
}
