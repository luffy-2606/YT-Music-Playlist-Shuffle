import * as esbuild from 'esbuild';
import { argv } from 'process';

const watch = argv.includes('--watch');

const sharedConfig = {
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  minify: false,
  sourcemap: true,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
};

const builds = [
  {
    entryPoints: ['src/content/index.ts'],
    outfile: 'dist/content.js',
    ...sharedConfig,
  },
  {
    entryPoints: ['src/popup/popup.ts'],
    outfile: 'dist/popup.js',
    ...sharedConfig,
  },
];

if (watch) {
  console.log('👀 Watching for changes...');
  const contexts = await Promise.all(builds.map(b => esbuild.context(b)));
  await Promise.all(contexts.map(ctx => ctx.watch()));
} else {
  console.log('🔨 Building extension...');
  await Promise.all(builds.map(b => esbuild.build(b)));
  console.log('✅ Build complete! Load the extension root directory in Chrome.');
}
