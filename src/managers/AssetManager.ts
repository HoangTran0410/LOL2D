import { assetManifest, type AssetKey, type AssetKind } from '@/generated/assetManifest';

export type { AssetKey, AssetKind } from '@/generated/assetManifest';

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
  return url =>
    new Promise((resolve, reject) => {
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
    audio.addEventListener('error', () => reject(new Error(`Failed to load ${url}`)), {
      once: true,
    });
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

/* ------------------------------------------------- surviving a memory purge */

/**
 * A canvas painted once and read back later, to find out whether the browser
 * threw the pixels away.
 *
 * p5 1.11 builds every `p5.Image` out of `document.createElement('canvas')`
 * (`p5.js:96392`) and `loadImage` draws the decoded `<img>` into it exactly once
 * before dropping it (`p5.js:94848`). So all ~370 assets in this game live as
 * off-DOM canvas backing stores — which is precisely the memory a mobile
 * browser reclaims while the app is in the background. Reported from a real
 * installed PWA: come back after five minutes and every avatar and every icon
 * is blank, while every shape the game *draws* is fine. That split is the
 * diagnosis, because vector drawing repaints the visible canvas each frame and
 * owes nothing to a stored one.
 *
 * A probe rather than sampling the assets: reading a pixel out of 370 images on
 * every resume is not free, and a transparent pixel is a perfectly ordinary
 * thing for an icon to have. One 1x1 canvas painted opaque answers the only
 * question that matters — the purge is wholesale, not per image.
 */
const PROBE_INK = 199;
let probeCanvas: HTMLCanvasElement | null = null;

function armProbe(): void {
  if (typeof document === 'undefined') return;
  if (!probeCanvas) {
    probeCanvas = document.createElement('canvas');
    probeCanvas.width = 1;
    probeCanvas.height = 1;
  }
  const context = probeCanvas.getContext('2d');
  if (!context) return;
  context.fillStyle = `rgb(${PROBE_INK},${PROBE_INK},${PROBE_INK})`;
  context.fillRect(0, 0, 1, 1);
}

function probeLost(): boolean {
  if (!probeCanvas) return false;
  const context = probeCanvas.getContext('2d');
  if (!context) return false;
  try {
    // Alpha, not the ink: a reclaimed backing store reads back fully
    // transparent, and comparing the colour would also flag a browser that
    // rounds it.
    return context.getImageData(0, 0, 1, 1).data[3] === 0;
  } catch {
    // A context that cannot be read at all is a lost one.
    return true;
  }
}

/** Decodes a URL into something `drawImage` accepts. Same origin, so no CORS. */
function decodeImageElement(url: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(`Failed to decode ${url}`));
    element.src = url;
  });
}

/** What the repaint needs of a `p5.Image`. */
interface RepaintableImage {
  drawingContext?: { drawImage(source: CanvasImageSource, x: number, y: number): void };
  setModified?: (value: boolean) => void;
}

export default class AssetManager {
  private static loaders = defaultLoaders;
  private static handles = new Map<AssetKey, AssetHandle>();
  private static loads = new Map<AssetKey, Promise<AssetHandle>>();
  /**
   * One in-flight load per *file*, not per key.
   *
   * Several keys routinely point at one file: Vite emits a single
   * content-hashed asset for byte-identical sources, and 17 groups of icons
   * here are literally the same picture — `jinx_q`, `jinx_q2`, `jinx_q3` and
   * `jinx_q4` are one PNG, as are Leblanc's four R stages. Keyed only by asset
   * key, each of those fetched the same bytes again: measured at 4 requests for
   * `jinx_q-CtVD-9_Y.png` in a production build, 762 requests for 372 distinct
   * files across the preload.
   *
   * Deliberately keyed on the resolved URL rather than the source path, because
   * in dev those four *are* four separate files and each has to be fetched.
   */
  private static loadsByUrl = new Map<string, Promise<unknown>>();
  /**
   * Files already given their one render-driven retry after a failed load.
   *
   * Keyed by URL for the same reason as `loadsByUrl`: aliases that point at one
   * image must not each open another request when their draw calls arrive on
   * neighbouring frames. An explicit `ensure` bypasses this set, and any
   * successful load clears it so a genuinely later failure starts fresh.
   */
  private static autoRetriedUrls = new Set<string>();
  private static placeholders = new Map<string, AssetHandle>();

  /**
   * Whether the browser has discarded the off-DOM canvas backing stores.
   *
   * A field rather than a method so the suite can state the answer: tests run
   * on `environment: 'node'`, where there is no canvas to probe.
   */
  static backingStoresLost: () => boolean = probeLost;

  /** Repaints the probe. Called after every recovery, and once at startup. */
  static armBackingStoreProbe: () => void = armProbe;

  /**
   * Repaints every loaded image back into the `p5.Image` that already holds it.
   *
   * **Into the same object**, which is the whole of it: every champion, spell
   * and HUD row is holding that reference, so swapping `handle.data` for a
   * freshly loaded image would fix the manager and leave all of them drawing a
   * blank. `drawingContext.drawImage` puts the pixels back where they were and
   * nobody downstream has to hear about it.
   *
   * Failures are per file. Offline with one entry missing from the precache is
   * a reason for that icon to stay blank, not for the other 369 to.
   */
  static async restoreImages(
    decode: (url: string) => Promise<CanvasImageSource> = decodeImageElement
  ): Promise<AssetKey[]> {
    const restored: AssetKey[] = [];
    const jobs: Promise<void>[] = [];

    for (const [key, handle] of this.handles) {
      if (handle.kind !== 'image' || handle.status !== 'ready') continue;
      const image = handle.data as RepaintableImage | null;
      if (!image?.drawingContext) continue;
      const url = handle.url;
      jobs.push(
        decode(url)
          .then(source => {
            image.drawingContext!.drawImage(source, 0, 0);
            // p5 uploads a texture from this canvas in WEBGL mode and caches
            // it; the flag is how it is told the pixels moved.
            image.setModified?.(true);
            restored.push(key);
          })
          .catch(() => undefined)
      );
    }

    await Promise.all(jobs);
    // Placeholders are `p5.Graphics`, so they were blanked too. They are looked
    // up by label on every draw and rebuild themselves lazily, so dropping them
    // is the whole repair.
    this.placeholders.clear();
    return restored;
  }

  /**
   * The one call a resume makes. Cheap when nothing was lost, which is most
   * resumes.
   */
  static async recoverIfLost(
    decode?: (url: string) => Promise<CanvasImageSource>
  ): Promise<AssetKey[]> {
    if (!this.backingStoresLost()) return [];
    const restored = await this.restoreImages(decode);
    this.armBackingStoreProbe();
    return restored;
  }

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
    handle.error = undefined;

    let bytes = this.loadsByUrl.get(handle.url);
    if (!bytes) {
      bytes = this.loaders[kind](handle.url);
      this.loadsByUrl.set(handle.url, bytes);
    }

    const load = bytes
      .then(data => {
        handle.data = data;
        handle.status = 'ready';
        handle.error = undefined;
        this.autoRetriedUrls.delete(handle.url);
        return handle;
      })
      .catch(error => {
        handle.error = toError(error);
        handle.status = 'error';
        // Cache only work that can still succeed. A dropped request during
        // preload must be retryable when the same portrait/icon is rendered or
        // requested again later; the handle itself stays stable for callers.
        this.loads.delete(key);
        if (this.loadsByUrl.get(handle.url) === bytes) this.loadsByUrl.delete(handle.url);
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
    const shouldStart =
      handle?.key &&
      (handle.status === 'idle' ||
        (handle.status === 'error' && !this.autoRetriedUrls.has(handle.url)));
    if (shouldStart && handle?.key) {
      if (handle.status === 'error') this.autoRetriedUrls.add(handle.url);
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

  static getRandomChampion(): AssetHandle {
    const keys = Object.keys(assetManifest).filter(key => key.startsWith('champ_')) as AssetKey[];
    return this.get(keys[Math.floor(Math.random() * keys.length)]);
  }
}
