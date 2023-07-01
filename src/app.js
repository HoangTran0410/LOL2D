import * as funcs from './game/main.js';

for (let key in funcs) {
  window[key] = funcs[key];
}
