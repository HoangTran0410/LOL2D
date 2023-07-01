import * as funcs from './sketch.js';

for (let key in funcs) {
  window[key] = funcs[key];
}
