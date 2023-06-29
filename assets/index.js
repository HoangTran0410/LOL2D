const ASSETS = {
  Champions: {},
  Spells: {},
  Buffs: {},
  Objects: {},
};
export default ASSETS;

export function preload() {
  // Champions
  Object.entries({
    blitzcrank: 'assets/champions/blitzcrank.png',
    lux: 'assets/champions/lux.png',
    jinx: 'assets/champions/jinx.png',
    yasuo: 'assets/champions/yasuo.png',
    ashe: 'assets/champions/ashe.png',
    teemo: 'assets/champions/teemo.png',
    ahri: 'assets/champions/ahri.png',
    zed: 'assets/champions/zed.png',
    leblanc: 'assets/champions/leblanc.png',
  }).forEach(([name, path]) => {
    ASSETS.Champions[name] = {
      image: loadImage(path),
      path,
    };
  });

  // Spells
  Object.entries({
    ashe_w: 'assets/spells/ashe_w.png',
    ashe_r: 'assets/spells/ashe_r.png',
    blitzcrank_internal: 'assets/spells/blitzcrank_internal.png',
    blitzcrank_q: 'assets/spells/blitzcrank_q.png',
    blitzcrank_w: 'assets/spells/blitzcrank_w.png',
    blitzcrank_e: 'assets/spells/blitzcrank_e.png',
    blitzcrank_r: 'assets/spells/blitzcrank_r.png',
    lux_q: 'assets/spells/lux_q.png',
    lux_e: 'assets/spells/lux_e.png',
    lux_r: 'assets/spells/lux_r.png',
    yasuo_q1: 'assets/spells/yasuo_q1.png',
    yasuo_q2: 'assets/spells/yasuo_q2.png',
    yasuo_q3: 'assets/spells/yasuo_q3.png',
    yasuo_w: 'assets/spells/yasuo_w.png',
    yasuo_e: 'assets/spells/yasuo_e.png',
    yasuo_r: 'assets/spells/yasuo_r.png',
    teemo_r: 'assets/spells/teemo_r.png',
    flash: 'assets/spells/flash.png',
    ghost: 'assets/spells/ghost.png',
    heal: 'assets/spells/heal.png',
    ignite: 'assets/spells/ignite.png',
  }).forEach(([name, path]) => {
    ASSETS.Spells[name] = {
      image: loadImage(path),
      path,
    };
  });

  // Buffs
  Object.entries({
    silence: 'assets/buffs/silence.png',
    slow: 'assets/buffs/slow.png',
    root: 'assets/buffs/root.png',
    airborne: 'assets/buffs/airborne.png',
    stun: 'assets/buffs/stun.png',
  }).forEach(([name, path]) => {
    ASSETS.Buffs[name] = {
      image: loadImage(path),
      path,
    };
  });

  // Objects
  Object.entries({
    yasuo_q3: 'assets/objects/yasuo_q3.png',
  }).forEach(([name, path]) => {
    ASSETS.Objects[name] = {
      image: loadImage(path),
      path,
    };
  });
}
