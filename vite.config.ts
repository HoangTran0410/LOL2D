import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cpSync } from 'fs';

export default defineConfig({
  root: '.',
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
  },
  plugins: [
    {
      // Game assets (images/json) are loaded at runtime by path string
      // (AssetManager → loadImage/loadJSON), so Vite never sees them as
      // imports and won't emit them — copy the whole folder into dist.
      name: 'copy-runtime-assets',
      apply: 'build',
      closeBundle() {
        cpSync(resolve(__dirname, 'assets'), resolve(__dirname, 'dist/assets'), {
          recursive: true,
        });
      },
    },
  ],
});
