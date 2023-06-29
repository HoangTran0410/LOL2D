import * as funcs from './js/main.js';
import { zzfx } from './js/lib/zzfx.js';

for (let key in funcs) {
  window[key] = funcs[key];
}

// zzfx(...[, , 348, 0.01, 0.02, 0.01, , 1.07, 1, 0.2, , , , , , , , 0.57, 0.02]); // Shoot 19
// zzfx(...[, , 925, 0.04, 0.3, 0.6, 1, 0.3, , 6.27, -184, 0.09, 0.17]); // Game over
// zzfx(...[, , 537, 0.02, 0.02, 0.22, 1, 1.59, -6.98, 4.97]); // Heart
// zzfx(...[1.5, 0.8, 270, , 0.1, , 1, 1.5, , , , , , , , 0.1, 0.01]); // Piano
// zzfx(...[, , 129, 0.01, , 0.15, , , , , , , , 5]); // Drum

// var peer2 = new Peer();

// console.log(peer2);
