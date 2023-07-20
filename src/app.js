import * as funcs from './sketch.js';
import { every, filter, forEach, map, some } from './utils/optimized.utils.js';

for (let key in funcs) {
  window[key] = funcs[key];
}

Array.prototype.map = function (callback) {
  return map(this, callback);
};
Array.prototype.forEach = function (callback) {
  return forEach(this, callback);
};
Array.prototype.some = function (callback) {
  return some(this, callback);
};
Array.prototype.every = function (callback) {
  return every(this, callback);
};
Array.prototype.filter = function (callback) {
  return filter(this, callback);
};
