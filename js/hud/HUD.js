import SpellState from '../enums/SpellState.js';

export default class HUD {
  constructor(game) {
    this.game = game;

    this.initVue();
  }

  initVue() {
    const { createApp } = Vue;
    createApp({
      data() {
        console.log(this);
        return {
          avatar: 'assets/champions/blitzcrank.png',
          spells: [
            { image: 'assets/spells/blitzcrank_internal.png', coolDown: 0 },

            { image: 'assets/spells/blitzcrank_q.png', coolDown: 0 },
            { image: 'assets/spells/blitzcrank_w.png', coolDown: 0 },
            { image: 'assets/spells/blitzcrank_e.png', coolDown: 0 },
            { image: 'assets/spells/blitzcrank_r.png', coolDown: 0 },

            { image: 'assets/spells/flash.png', coolDown: 0 },
            { image: 'assets/spells/heal.png', coolDown: 0 },
          ],
          buffs: [],
        };
      },
      methods: {},
    }).mount('#HUD');
  }

  update() {}

  draw() {}
}
