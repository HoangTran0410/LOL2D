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
    ASSETS.Champions[name] = loadImage(path);
  });

  // Spells
  Object.entries({
    blitzcrank_w: 'assets/spells/blitzcrank_w.png',
  }).forEach(([name, path]) => {
    ASSETS.Spells[name] = loadImage(path);
  });

  // Buffs
  Object.entries({
    // TODO: add buff images
  }).forEach(([name, path]) => {
    ASSETS.Buffs[name] = loadImage(path);
  });
}
