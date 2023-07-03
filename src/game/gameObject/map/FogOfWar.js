export default class FogOfWar {
  constructor(game) {
    this.game = game;

    this.overlay = createGraphics(windowWidth, windowHeight);
    this.outOfViewColor = '#0008';

    this.colorStops = [
      { stop: 0, color: '#fff' },
      { stop: 1, color: '#0001' },
    ];
  }
}
