import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // InGameHUD passes an in-string `template:` option, which needs the
      // runtime compiler — the default bundler entry is runtime-only.
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
