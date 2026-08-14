import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Single-file components are compiled at build time and need only the
      // runtime. This alias is the *other* case: an in-string `template:`
      // option, which is compiled in the browser and therefore needs the
      // compiler shipped with it.
      //
      // It is here only until the last of those is gone. Every one that
      // remains costs ~14KB gzip of compiler in the bundle and, more to the
      // point, is a template `vue-tsc` cannot check — which is the whole
      // reason for moving to SFCs. Delete this alias when nothing passes a
      // string template any more, and `npm run build` will tell you
      // immediately if something still does.
      vue: 'vue/dist/vue.esm-bundler.js',
    },
  },
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  assetsInclude: ['**/*.json'],
  build: {
    target: 'esnext',
    assetsInlineLimit: 0,
  },
});
