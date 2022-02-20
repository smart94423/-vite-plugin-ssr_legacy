import vue from '@vitejs/plugin-vue'
import md from 'vite-plugin-md'
import ssr from 'vite-plugin-ssr/plugin'
import { UserConfig } from 'vite'

const config: UserConfig = {
  plugins: [
    vue({
      include: [/\.vue$/, /\.md$/],
    }),
    md(),
    ssr(),
  ],
  clearScreen: false,
  // Neeed if using an ESM-only library. This is not the case of this example and it's, in general, a rare case. But such situation will increasingly occur as ESM-only libraries emerge.
  build: {
    rollupOptions: {
      output: {
        format: 'es', // Transpile to ESM instead of CJS
      },
    },
  },
}

export default config
