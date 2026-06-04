import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Legacy Angular port source (One-Eyed Willy's Plinko, formerly crimson-plinko). */
const legacyAngularSource =
	'E:/Projects/Web/ThirdPartyClients/Crash/crimson-plinko/src/app/components';

function portMeter(sourcePath, className, outPath) {
	let code = readFileSync(sourcePath, 'utf8');
	const classStart = code.indexOf(`export class ${className}`);
	code = code.slice(classStart);
	code = code
		.replace(/@Component\(\{[\s\S]*?\}\)\n/, '')
		.replace(new RegExp(`export class ${className}[\\s\\S]*?implements[^{]+\\{`), `export class ${className} {`)
		.replace(/@ViewChild\([^)]+\)[^;]+;/g, '')
		.replace(/@Input\(\) /g, '')
		.replace(/implements AfterViewInit, OnChanges, OnDestroy/g, '')
		.replace(/implements AfterViewInit, OnDestroy/g, '')
		.replace(/implements OnInit, AfterViewInit, OnDestroy/g, '')
		.replace(/ngAfterViewInit\(\): Promise<void> \{[\s\S]*?await this\.initPixi\(\);[\s\S]*?\}/, 'async init(host: HTMLElement): Promise<void> {\n\t\tthis.hostElement = host;\n\t\tawait this.initPixi();\n\t}')
		.replace(/ngOnChanges\(changes: SimpleChanges\): void \{[\s\S]*?\}\n\n/, '')
		.replace(/ngOnDestroy\(\): void/, 'destroy(): void')
		.replace(/this\.meterHost\.nativeElement/g, 'this.hostElement')
		.replace(/Assets\.load\('assets\/img\//g, "Assets.load('/img/")
		.replace(/markerLeftPx = /g, 'markerLeftPx: number = ')
		.replace(/markerTopPx = /g, 'markerTopPx: number = ')
		.replace(/markerSizePx = /g, 'markerSizePx: number = ');

	const header = `import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';

`;

	const ctor = `
\tprivate hostElement!: HTMLElement;

\tsetProgress(value: number): void {
\t\tthis.setTargetProgress(value);
\t}

`;

	code = header + code.replace(`export class ${className} {`, `export class ${className} {` + ctor);

	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, code);
	console.log('Wrote', outPath);
}

portMeter(
	join(legacyAngularSource, 'bonus-meter/bonus-meter.component.ts'),
	'BonusMeterComponent',
	join(root, 'src/features/bonus/BonusMeterEngine.ts'),
);
portMeter(
	join(legacyAngularSource, 'free-spin-meter/free-spin-meter.component.ts'),
	'FreeSpinMeterComponent',
	join(root, 'src/features/freeSpin/FreeSpinMeterEngine.ts'),
);
