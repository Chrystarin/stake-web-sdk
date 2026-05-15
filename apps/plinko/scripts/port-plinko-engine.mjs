import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
let code = readFileSync(join(root, 'src-plinko-engine-source.ts'), 'utf8');

// Remove everything before the Ball interface
const ballIdx = code.indexOf('interface Ball');
code = code.slice(ballIdx);

const header = `import { Application, Assets, Container, FillGradient, Graphics, Sprite, Text } from 'pixi.js';
import { formatCoefficientLabel, isMobile } from '../lib/format';

export type BallDroppedEvent = {
	multiplier: number;
	ballId: number;
	slotIndex: number;
	isSpinSlot: boolean;
};

export type CoinPegHitEvent = { row: number; col: number };

export type PlinkoEngineOptions = {
	hostElement: HTMLElement;
	onBallDropped?: (event: BallDroppedEvent) => void;
	onCoinPegHit?: (event: CoinPegHitEvent) => void;
};

`;

code = header + code;

code = code
	.replace(/@Component\(\{[\s\S]*?\}\)\n/, '')
	.replace(/export class PixiPlinkoComponent/g, 'export class PlinkoEngine')
	.replace(/@Input\(\) /g, '')
	.replace(
		/@Output\(\) ballDropped = new EventEmitter<\{ multiplier: number; ballId: number; slotIndex: number; isSpinSlot: boolean \}>\(\);/,
		'onBallDropped?: (event: BallDroppedEvent) => void;',
	)
	.replace(
		/@Output\(\) coinPegHit = new EventEmitter<\{ row: number; col: number \}>\(\);/,
		'onCoinPegHit?: (event: CoinPegHitEvent) => void;',
	)
	.replace(/@ViewChild\('pixiContainer', \{ static: true \}\) pixiContainer!: ElementRef<HTMLDivElement>;/, 'private hostElement: HTMLElement;')
	.replace(/private readonly amountPipe = new AmountPipe\(inject\(DecimalPipe\)\);/, '')
	.replace(/utils = new Utils\(\);/, '')
	.replace(/this\.utils\.isMobile\(\)/g, 'isMobile()')
	.replace(/this\.amountPipe\.transform\(([^,]+), '[^']+'\)/g, 'formatCoefficientLabel($1)')
	.replace(/this\.ballDropped\.emit\(/g, 'this.onBallDropped?.(')
	.replace(/this\.coinPegHit\.emit\(/g, 'this.onCoinPegHit?.(')
	.replace(/this\.pixiContainer\.nativeElement/g, 'this.hostElement')
	.replace(/this\.pixiContainer\?\.nativeElement/g, 'this.hostElement')
	.replace(/ngOnInit\(\): void \{[\s\S]*?\}\n\n/, '')
	.replace(/async ngAfterViewInit\(\): Promise<void> \{[\s\S]*?\}\n\n/, '')
	.replace(
		/ngOnChanges\(changes: SimpleChanges\): void \{[\s\S]*?\}\n\n/,
		`updateScene(coefficients: number[], rows: number, animationEnabled?: boolean): void {
		if (coefficients?.length) this.coefficients = coefficients;
		if (rows) this.rows = rows;
		if (animationEnabled !== undefined) this.animationEnabled = animationEnabled;
		if (this.coefficients?.length && this.rows && this.pixiReady) {
			this.updateContainerSize();
			this.rebuildScene();
		}
	}

`,
	)
	.replace(/ngOnDestroy\(\): void/, 'destroy(): void');

code = code.replace(
	/export class PlinkoEngine \{/,
	`export class PlinkoEngine {
	constructor(options: PlinkoEngineOptions) {
		this.hostElement = options.hostElement;
		this.onBallDropped = options.onBallDropped;
		this.onCoinPegHit = options.onCoinPegHit;
		if (isMobile()) {
			this.pyramidConfig.bounceAmplitude = 12;
		}
	}

	async init(): Promise<void> {
		await this.initPixi();
	}
`,
);

mkdirSync(join(root, 'src/plinko-engine'), { recursive: true });
writeFileSync(join(root, 'src/plinko-engine/PlinkoEngine.ts'), code);
console.log('Wrote PlinkoEngine.ts', code.split('\n').length, 'lines');
