import {
  assetManifest,
  type AssetKey,
  type AssetKind,
} from '../generated/assetManifest';

export type { AssetKey, AssetKind } from '../generated/assetManifest';

export interface AssetHandle<T = unknown> {
  readonly key: AssetKey | null;
  readonly kind: AssetKind;
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  url: string;
  readonly path: string;
  error?: Error;
}

export interface AssetLoaders {
  image: (url: string) => Promise<unknown>;
  json: (url: string) => Promise<unknown>;
  audio: (url: string) => Promise<unknown>;
}

/** @deprecated Prefer AssetHandle through get/ensure. */
export interface LoadedAsset extends AssetHandle<unknown> {}

const PLACEHOLDER_SIZE = 64;

function placeholderStyle(key: string): { label: string; hue: number } {
  const cleaned = key.replace(/^(spell|buff|obj|champ|monster)_/, '');
  const label = cleaned
    .split('_')
    .filter(Boolean)
    .map(part => part[0].toUpperCase())
    .join('')
    .slice(0, 3);

  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return { label: label || '?', hue: Math.abs(hash) % 360 };
}

function placeholderSvgDataUri(label: string, hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PLACEHOLDER_SIZE}" height="${PLACEHOLDER_SIZE}">` +
    `<rect width="100%" height="100%" fill="hsl(${hue} 45% 26%)"/>` +
    `<rect x="2" y="2" width="${PLACEHOLDER_SIZE - 4}" height="${PLACEHOLDER_SIZE - 4}" ` +
    `fill="none" stroke="hsl(${hue} 60% 62%)" stroke-width="3"/>` +
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="sans-serif" font-size="26" font-weight="bold" fill="hsl(${hue} 75% 82%)">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface PlaceholderGraphics {
  colorMode(mode: unknown, max1: number, max2: number, max3: number): void;
  noStroke(): void;
  fill(...values: number[]): void;
  rect(x: number, y: number, width: number, height: number): void;
  noFill(): void;
  stroke(...values: number[]): void;
  strokeWeight(weight: number): void;
  textAlign(horizontal: unknown, vertical: unknown): void;
  textSize(size: number): void;
  textStyle(style: unknown): void;
  text(value: string, x: number, y: number): void;
}

function drawPlaceholderGraphics(label: string, hue: number): PlaceholderGraphics {
  const graphics = createGraphics(
    PLACEHOLDER_SIZE,
    PLACEHOLDER_SIZE
  ) as unknown as PlaceholderGraphics;
  graphics.colorMode(HSL, 360, 100, 100);
  graphics.noStroke();
  graphics.fill(hue, 45, 26);
  graphics.rect(0, 0, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE);
  graphics.noFill();
  graphics.stroke(hue, 60, 62);
  graphics.strokeWeight(3);
  graphics.rect(2, 2, PLACEHOLDER_SIZE - 4, PLACEHOLDER_SIZE - 4);
  graphics.noStroke();
  graphics.fill(hue, 75, 82);
  graphics.textAlign(CENTER, CENTER);
  graphics.textSize(26);
  graphics.textStyle(BOLD);
  graphics.text(label, PLACEHOLDER_SIZE / 2, PLACEHOLDER_SIZE / 2);
  return graphics;
}

function p5Loader(name: 'loadImage' | 'loadJSON'): (url: string) => Promise<unknown> {
  return url => new Promise((resolve, reject) => {
    const candidate = (globalThis as unknown as Record<string, unknown>)[name];
    if (typeof candidate !== 'function') {
      reject(new Error(`${name} is not available`));
      return;
    }
    const loader = candidate as (
      path: string,
      success: (data: unknown) => void,
      failure: (error: unknown) => void
    ) => void;
    loader(url, resolve, error => reject(toError(error)));
  });
}

function audioLoader(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.addEventListener('canplaythrough', () => resolve(audio), { once: true });
    audio.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)), { once: true });
    audio.src = url;
  });
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

const defaultLoaders: AssetLoaders = {
  image: p5Loader('loadImage'),
  json: p5Loader('loadJSON'),
  audio: audioLoader,
};

export default class AssetManager {
  private static loaders = defaultLoaders;
  private static handles = new Map<AssetKey, AssetHandle>();
  private static loads = new Map<AssetKey, Promise<AssetHandle>>();
  private static placeholders = new Map<string, AssetHandle>();
  private static warnedPlaceholders = new Set<string>();

  static configureLoaders(loaders: AssetLoaders): void {
    this.loaders = loaders;
  }

  static get(key: AssetKey): AssetHandle {
    const cached = this.handles.get(key);
    if (cached) return cached;

    const asset = assetManifest[key];
    const handle: AssetHandle = {
      key,
      kind: asset.kind,
      status: 'idle',
      data: null,
      url: asset.url,
      path: asset.url,
    };
    this.handles.set(key, handle);
    return handle;
  }

  static ensure(key: AssetKey): Promise<AssetHandle> {
    const existing = this.loads.get(key);
    if (existing) return existing;

    const handle = this.get(key);
    const kind = handle.kind;
    if (kind === 'url') {
      handle.status = 'ready';
      handle.data = handle.url;
      const ready = Promise.resolve(handle);
      this.loads.set(key, ready);
      return ready;
    }

    handle.status = 'loading';
    const load = this.loaders[kind](handle.url)
      .then(data => {
        handle.data = data;
        handle.status = 'ready';
        return handle;
      })
      .catch(error => {
        handle.error = toError(error);
        handle.status = 'error';
        throw handle.error;
      });
    this.loads.set(key, load);
    return load;
  }

  static ensureMany(keys: readonly AssetKey[]): Promise<AssetHandle[]> {
    return Promise.all(keys.map(key => this.ensure(key)));
  }

  static renderable(handle: AssetHandle | undefined, label?: string): unknown {
    if (handle?.status === 'ready' && handle.data !== null) return handle.data;
    if (handle?.key && handle.status === 'idle') {
      void this.ensure(handle.key).catch(() => undefined);
    }
    return this.placeholder(label ?? handle?.key ?? 'Missing asset').data!;
  }

  static placeholder(label: string): AssetHandle {
    if (!label.trim()) throw new Error('Placeholder label is required');

    const cached = this.placeholders.get(label);
    if (cached) return cached;

    const { label: initials, hue } = placeholderStyle(label);
    const url = placeholderSvgDataUri(initials, hue);
    let graphics: unknown = null;
    const handle = {
      key: null,
      kind: 'image',
      status: 'ready',
      url,
      path: url,
      get data() {
        if (!graphics && typeof createGraphics === 'function') {
          graphics = drawPlaceholderGraphics(initials, hue);
        }
        return graphics;
      },
      set data(value: unknown) {
        graphics = value;
      },
    } satisfies AssetHandle;
    this.placeholders.set(label, handle);
    return handle;
  }

  static getRandomChampion(): LoadedAsset {
    const keys = Object.keys(assetManifest).filter(
      key => key.startsWith('champ_') && !key.startsWith('champ_background_')
    ) as AssetKey[];
    return this.get(keys[Math.floor(Math.random() * keys.length)]) as LoadedAsset;
  }

  /** @deprecated Use get with an AssetKey, or placeholder with an explicit label. */
  static getAsset(key: string | null | undefined): LoadedAsset | undefined {
    if (!key) return undefined;
    if (key in assetManifest) return this.get(key as AssetKey) as LoadedAsset;

    if (!this.warnedPlaceholders.has(key)) {
      this.warnedPlaceholders.add(key);
      console.warn(`[AssetManager] unknown legacy asset "${key}", using a placeholder`);
    }
    return this.placeholder(key) as LoadedAsset;
  }
}
