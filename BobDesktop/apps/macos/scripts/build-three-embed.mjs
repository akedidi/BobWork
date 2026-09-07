import { build } from 'vite'

// The sandboxed HTML previews need a classic, local script.  Building this
// small compatibility entry separately keeps Three.js out of the initial app
// bundle and avoids a network/CDN dependency in artifacts.
await build({
  configFile: false,
  publicDir: false,
  // ECharts still contains development guards that reference Node's
  // `process.env.NODE_ENV`.  The preview bridge executes in a plain browser
  // document where `process` does not exist, so replace those guards while
  // bundling instead of letting the whole Three/ECharts bridge abort.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    emptyOutDir: false,
    outDir: 'public/runtime',
    lib: {
      entry: 'src/runtime/threeEmbedBridge.ts',
      formats: ['iife'],
      name: 'BobWorkThreeEmbed',
      fileName: () => 'three-embed-bridge.js',
    },
  },
})
