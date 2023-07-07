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
  champ_ahri: 'assets/images/champions/ahri.png',

  // spells
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

  // buffs
  buff_silence: 'assets/images/buffs/silence.png',
  buff_slow: 'assets/images/buffs/slow.png',
  buff_root: 'assets/images/buffs/root.png',
  buff_airborne: 'assets/images/buffs/airborne.png',
  buff_stun: 'assets/images/buffs/stun.png',
  buff_charm: 'assets/images/buffs/charm.png',
  buff_nearsight: 'assets/images/buffs/nearsight.png',
  buff_fear: 'assets/images/buffs/fear.png',

  // objects
  obj_yasuo_q3: 'assets/images/objects/yasuo_q3.png',

  // json
  json_summoner_map: 'assets/json/summoner_map.json',
};

export default class AssetManager {
  static _asset = {
    // _key: {
    //   data: 'string',
    //   path: 'string',
    // }
  };

  static getRandomChampion() {
    const keys = Object.keys(AssetPaths);
    const filteredKeys = keys.filter(key => key.startsWith('champ_'));
    const randomKey = filteredKeys[Math.floor(Math.random() * filteredKeys.length)];

    return (
      this._asset[randomKey] || {
        data: null,
        path: null,
      }
    );
  }

  static getAsset(key) {
    return this._asset[key];
  }

  static loadAssets(onProgress, onSuccess, onFailed) {
    let loadedCount = 0;
    let hasError = false;

    const entries = Object.entries(AssetPaths);
    const total = entries.length;

    for (const [key, path] of entries) {
      let func = key.startsWith('json') ? loadJSON : loadImage;
      func(
        path,
        // success
        data => {
          this._asset[key] = { data, path };
          loadedCount++;

          onProgress?.({
            index: loadedCount,
            total: total,
            path: path,
          });

          if (loadedCount == total && !hasError) {
            onSuccess?.();
          }
        },
        // failed
        error => {
          hasError = true;
          onFailed?.({ path, error });
        }
      );
    }
  }
}
