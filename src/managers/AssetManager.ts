// p5 globals (loadImage, loadJSON) are declared globally in src/types/global.d.ts
const AssetPaths = {
  // champions
  champ_blitzcrank: 'assets/images/champions/blitzcrank.png',
  champ_lux: 'assets/images/champions/lux.png',
  champ_jinx: 'assets/images/champions/jinx.png',
  champ_yasuo: 'assets/images/champions/yasuo.png',
  champ_ashe: 'assets/images/champions/ashe.png',
  champ_teemo: 'assets/images/champions/teemo.png',
  champ_ahri: 'assets/images/champions/ahri.png',
  champ_zed: 'assets/images/champions/zed.png',
  champ_leblanc: 'assets/images/champions/leblanc.png',
  champ_leesin: 'assets/images/champions/leesin.png',
  champ_chogath: 'assets/images/champions/chogath.png',
  champ_shaco: 'assets/images/champions/shaco.png',
  champ_olaf: 'assets/images/champions/olaf.png',
  champ_malphite: 'assets/images/champions/malphite.png',
  champ_veigar: 'assets/images/champions/veigar.png',
  champ_graves: 'assets/images/champions/graves.png',

  // spells
  spell_stealthward: 'assets/images/spells/stealthward.png',
  spell_flash: 'assets/images/spells/flash.png',
  spell_ghost: 'assets/images/spells/ghost.png',
  spell_heal: 'assets/images/spells/heal.png',
  spell_ignite: 'assets/images/spells/ignite.png',
  spell_leblanc_w1: 'assets/images/spells/leblanc_w1.png',
  spell_leblanc_w2: 'assets/images/spells/leblanc_w2.png',
  spell_leblanc_e: 'assets/images/spells/leblanc_e.png',
  spell_leesin_q1: 'assets/images/spells/leesin_q1.png',
  spell_leesin_q2: 'assets/images/spells/leesin_q2.png',
  spell_leesin_e: 'assets/images/spells/leesin_e.png',
  spell_leesin_r: 'assets/images/spells/leesin_r.png',
  spell_ashe_w: 'assets/images/spells/ashe_w.png',
  spell_ashe_r: 'assets/images/spells/ashe_r.png',
  spell_blitzcrank_internal: 'assets/images/spells/blitzcrank_internal.png',
  spell_blitzcrank_q: 'assets/images/spells/blitzcrank_q.png',
  spell_blitzcrank_w: 'assets/images/spells/blitzcrank_w.png',
  spell_blitzcrank_e: 'assets/images/spells/blitzcrank_e.png',
  spell_blitzcrank_r: 'assets/images/spells/blitzcrank_r.png',
  spell_lux_q: 'assets/images/spells/lux_q.png',
  spell_lux_e: 'assets/images/spells/lux_e.png',
  spell_lux_r: 'assets/images/spells/lux_r.png',
  spell_yasuo_q1: 'assets/images/spells/yasuo_q1.png',
  spell_yasuo_q2: 'assets/images/spells/yasuo_q2.png',
  spell_yasuo_q3: 'assets/images/spells/yasuo_q3.png',
  spell_yasuo_w: 'assets/images/spells/yasuo_w.png',
  spell_yasuo_e: 'assets/images/spells/yasuo_e.png',
  spell_yasuo_r: 'assets/images/spells/yasuo_r.png',
  spell_teemo_r: 'assets/images/spells/teemo_r.png',
  spell_chogath_q: 'assets/images/spells/chogath_q.png',
  spell_chogath_w: 'assets/images/spells/chogath_w.png',
  spell_ahri_q: 'assets/images/spells/ahri_q.png',
  spell_ahri_w: 'assets/images/spells/ahri_w.png',
  spell_ahri_e: 'assets/images/spells/ahri_e.png',
  spell_ahri_r: 'assets/images/spells/ahri_r.png',
  spell_veigar_e: 'assets/images/spells/veigar_e.png',
  spell_shaco_q: 'assets/images/spells/shaco_q.png',
  spell_shaco_w: 'assets/images/spells/shaco_w.png',
  spell_shaco_e: 'assets/images/spells/shaco_e.png',
  spell_shaco_r: 'assets/images/spells/shaco_r.png',
  spell_shaco_r2: 'assets/images/spells/shaco_r2.png',
  spell_malphite_r: 'assets/images/spells/malphite_r.png',
  spell_olaf_q: 'assets/images/spells/olaf_q.png',
  spell_zed_q: 'assets/images/spells/zed_q.png',
  spell_zed_w: 'assets/images/spells/zed_w.png',
  spell_zed_w2: 'assets/images/spells/zed_w2.png',
  spell_zed_e: 'assets/images/spells/zed_e.png',
  spell_graves_w: 'assets/images/spells/graves_w.png',
  spell_zed_r1: 'assets/images/spells/zed_r1.png',
  spell_zed_r2: 'assets/images/spells/zed_r2.png',
  spell_rammus_q: 'assets/images/spells/rammus_q.png',
  spell_teemo_q: 'assets/images/spells/teemo_q.png',
  spell_anivia_q: 'assets/images/spells/anivia_q.png',
  spell_anivia_w: 'assets/images/spells/anivia_w.png',
  spell_anivia_r: 'assets/images/spells/anivia_r.png',
  spell_thresh_q: 'assets/images/spells/thresh_q.png',
  spell_thresh_q2: 'assets/images/spells/thresh_q2.png',

  // buffs
  buff_silence: 'assets/images/buffs/silence.png',
  buff_slow: 'assets/images/buffs/slow.png',
  buff_root: 'assets/images/buffs/root.png',
  buff_airborne: 'assets/images/buffs/airborne.png',
  buff_stun: 'assets/images/buffs/stun.png',
  buff_charm: 'assets/images/buffs/charm.png',
  buff_nearsight: 'assets/images/buffs/nearsight.png',
  buff_fear: 'assets/images/buffs/fear.png',
  buff_invisible: 'assets/images/buffs/invisible.png',
  buff_truesight: 'assets/images/buffs/truesight.png',
  buff_poison: 'assets/images/buffs/poison.png',
  buff_ground: 'assets/images/buffs/ground.png',
  buff_untargetable: 'assets/images/buffs/untargetable.png',
  buff_stasis: 'assets/images/buffs/untargetable.png',

  // objects
  obj_yasuo_q3: 'assets/images/objects/yasuo_q3.png',

  // monsters
  monster_Ancient_Krug: 'assets/images/monsters/Ancient_Krug.png',
  monster_Blue_Sentinel: 'assets/images/monsters/Blue_Sentinel.png',
  monster_Crimson_Raptor: 'assets/images/monsters/Crimson_Raptor.png',
  monster_Raptor: 'assets/images/monsters/Raptor.png',
  monster_Gromp: 'assets/images/monsters/Gromp.png',
  monster_Greater_Murk_Wolf: 'assets/images/monsters/Greater_Murk_Wolf.png',
  monster_Murk_Wolf: 'assets/images/monsters/Murk_Wolf.png',
  monster_Rift_Scuttle: 'assets/images/monsters/Rift_Scuttle.png',
  monster_Red_Brambleback: 'assets/images/monsters/Red_Brambleback.png',
  monster_Baron_Nashor: 'assets/images/monsters/Baron_Nashor.png',

  // json
  json_summoner_map: 'assets/json/summoner_map.json',
} as const;

export type AssetKey = keyof typeof AssetPaths;

const PLACEHOLDER_SIZE = 64;

/** Initials + a stable colour derived from the key, so each spell looks distinct. */
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

function drawPlaceholderGraphics(label: string, hue: number): any {
  // p5's Graphics type omits the drawing methods it actually forwards
  const g = createGraphics(PLACEHOLDER_SIZE, PLACEHOLDER_SIZE) as any;
  g.colorMode(HSL, 360, 100, 100);
  g.noStroke();
  g.fill(hue, 45, 26);
  g.rect(0, 0, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE);

  g.noFill();
  g.stroke(hue, 60, 62);
  g.strokeWeight(3);
  g.rect(2, 2, PLACEHOLDER_SIZE - 4, PLACEHOLDER_SIZE - 4);

  g.noStroke();
  g.fill(hue, 75, 82);
  g.textAlign(CENTER, CENTER);
  g.textSize(26);
  g.textStyle(BOLD);
  g.text(label, PLACEHOLDER_SIZE / 2, PLACEHOLDER_SIZE / 2);

  return g;
}

export interface LoadedAsset {
  data: any;
  path: string;
}

export interface LoadProgressEvent {
  index: number;
  total: number;
  path: string;
}

export interface LoadFailedEvent {
  path: string;
  error: any;
}

export default class AssetManager {
  static _asset: Record<string, LoadedAsset> = {};

  static getRandomChampion(): LoadedAsset {
    const keys = Object.keys(AssetPaths);
    const filteredKeys = keys.filter(key => key.startsWith('champ_'));
    const randomKey = filteredKeys[Math.floor(Math.random() * filteredKeys.length)] as any;

    return (
      this._asset[randomKey] ?? {
        data: null,
        path: null,
      }
    );
  }

  /**
   * Real art if we have it, otherwise a generated stand-in so a spell without an
   * icon still renders as a labelled tile instead of a broken image. Drop a real
   * file into AssetPaths under the same key and the placeholder disappears.
   */
  static getAsset(key: string): LoadedAsset | undefined {
    const loaded = this._asset[key];
    if (loaded) return loaded;

    // callers pass an absent key on purpose (e.g. `getAsset(preset?.avatar)`);
    // only a real key earns a placeholder
    if (!key || typeof key !== 'string') return undefined;

    return this._getPlaceholder(key);
  }

  static _placeholders: Record<string, LoadedAsset> = {};
  static _warnedPlaceholders = new Set<string>();

  static _getPlaceholder(key: string): LoadedAsset {
    const cached = this._placeholders[key];
    if (cached) return cached;

    if (!this._warnedPlaceholders.has(key)) {
      this._warnedPlaceholders.add(key);
      console.warn(`[AssetManager] no art for "${key}", using a placeholder`);
    }

    const { label, hue } = placeholderStyle(key);

    // `path` feeds HTML <img> in the HUD; `data` feeds p5's image() on canvas.
    // data is built lazily because p5 globals do not exist at module-eval time.
    let graphics: any = null;
    const asset = {
      path: placeholderSvgDataUri(label, hue),
      get data() {
        if (!graphics && typeof createGraphics === 'function') {
          graphics = drawPlaceholderGraphics(label, hue);
        }
        return graphics;
      },
    } as LoadedAsset;

    this._placeholders[key] = asset;
    return asset;
  }

  static loadAssets(
    onProgress?: (event: LoadProgressEvent) => void,
    onSuccess?: () => void,
    onFailed?: (event: LoadFailedEvent) => void
  ): void {
    let loadedCount = 0;
    let hasError = false;

    const entries = Object.entries(AssetPaths) as [AssetKey, string][];
    const total = entries.length;

    for (const [key, path] of entries) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = key.startsWith('json') ? (window as any).loadJSON : (window as any).loadImage;
      fn(
        path,
        // success
        (data: any) => {
          this._asset[key] = { data, path };
          loadedCount++;

          onProgress?.({
            index: loadedCount,
            total,
            path,
          });

          if (loadedCount === total && !hasError) {
            onSuccess?.();
          }
        },
        // failed
        (error: any) => {
          hasError = true;
          onFailed?.({ path, error });
        }
      );
    }
  }
}
