const ASSETS = {
  Champions: {},
  Spells: {},
  Buffs: {},
};
export default ASSETS;

export function preload() {
  // Champions
  Object.entries({
    blitzcrank: 'assets/champions/blitzcrank.png',
    lux: 'assets/champions/lux.png',
    jinx: 'assets/champions/jinx.png',
    yasuo: 'assets/champions/yasuo.png',
  }).forEach(([name, path]) => {
    ASSETS.Champions[name] = {
      image: loadImage(path),
      path,
    };
  });

  // Spells
  Object.entries({
    blitzcrank_internal: 'assets/spells/blitzcrank_internal.png',
    blitzcrank_q: 'assets/spells/blitzcrank_q.png',
    blitzcrank_w: 'assets/spells/blitzcrank_w.png',
    blitzcrank_e: 'assets/spells/blitzcrank_e.png',
    blitzcrank_r: 'assets/spells/blitzcrank_r.png',
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
    // TODO: add buff images
  }).forEach(([name, path]) => {
    ASSETS.Buffs[name] = {
      image: loadImage(path),
      path,
    };
  });
}