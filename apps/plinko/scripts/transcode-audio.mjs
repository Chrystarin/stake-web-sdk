#!/usr/bin/env node
/**
 * Transcode delivered audio clips into the ONE format the game ships: tag-free MP3.
 *
 *   node scripts/transcode-audio.mjs <input>... [--out static/sound] [--bitrate 128k]
 *
 * Why MP3 and nothing else: it is the single codec every browser the game runs in decodes on BOTH of
 * Howler's paths — Web Audio `decodeAudioData` (one-shot SFX) and `<audio>` streaming (the music
 * loops). OGG/Vorbis and Opus never decode on iPhone/iPad, WAV is 10x the size for nothing, and a
 * codec hidden behind the wrong extension (`.mpeg` carrying MP3) gets served as `video/*`, which iOS
 * `<audio>` can refuse. See EnableSound.svelte.
 *
 * What the flags guarantee:
 *   - `-map 0:a:0 -vn`             audio only — embedded cover art would otherwise abort the muxer.
 *   - `-map_metadata -1`, no ID3    nothing but frames: no 19 KB of album art ahead of the first sample.
 *   - Xing/LAME "Info" frame kept   (ffmpeg's default) so Chrome/Safari/Firefox trim the encoder delay
 *                                   and padding — loops and sprite windows stay on time.
 *   - source sample rate kept       no resample pass; MP3 handles 44.1k and 48k natively.
 *   - 128 kbps CBR joint stereo     transparent enough for phone speakers, predictable for decoders.
 *
 * ⚠️ Re-encoding a clip that has SPRITE WINDOWS (coin_shuffle, door_*, bonus_congratulations) shifts
 * its onsets by up to one MP3 frame (26 ms) — re-measure the windows in EnableSound after doing so.
 *
 * ffmpeg: taken from $FFMPEG, then PATH, then the imageio-ffmpeg wheel's bundled full build
 * (`pip install imageio-ffmpeg` — it ships libmp3lame; the Playwright ffmpeg does not).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const inputs = [];
let outDir = 'static/sound';
let bitrate = '128k';
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--out') outDir = args[++i];
	else if (args[i] === '--bitrate') bitrate = args[++i];
	else inputs.push(args[i]);
}
if (!inputs.length) {
	console.error('usage: node scripts/transcode-audio.mjs <input>... [--out dir] [--bitrate 128k]');
	process.exit(2);
}

function findFfmpeg() {
	if (process.env.FFMPEG && existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
	const onPath = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
	if (onPath.status === 0) return 'ffmpeg';
	try {
		const exe = execFileSync('python', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], {
			encoding: 'utf8',
		}).trim();
		if (exe && existsSync(exe)) return exe;
	} catch {
		/* fall through */
	}
	console.error('ffmpeg not found: set $FFMPEG, put ffmpeg on PATH, or `pip install imageio-ffmpeg`.');
	process.exit(1);
}

const ffmpeg = findFfmpeg();
mkdirSync(outDir, { recursive: true });
for (const input of inputs) {
	const out = join(outDir, `${basename(input, extname(input))}.mp3`);
	const argv = [
		'-hide_banner', '-loglevel', 'error', '-y',
		'-i', resolve(input),
		'-map', '0:a:0', '-vn',
		'-map_metadata', '-1', '-write_id3v1', '0', '-id3v2_version', '0',
		'-c:a', 'libmp3lame', '-b:a', bitrate,
		out,
	];
	const r = spawnSync(ffmpeg, argv, { stdio: 'inherit' });
	if (r.status !== 0) {
		console.error(`failed: ${input}`);
		process.exit(r.status ?? 1);
	}
	console.log(`${input} -> ${out}`);
}
