import * as funcs from './js/main.js';

for (let key in funcs) {
  window[key] = funcs[key];
}

// var peer2 = new Peer();

// console.log(peer2);
