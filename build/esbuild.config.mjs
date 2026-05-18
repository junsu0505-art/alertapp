import * as esbuild from 'esbuild'
import { readFileSync } from 'fs'

const banner = readFileSync('userscript-header.txt', 'utf8')
const isWatch = process.argv.includes('--watch')
const isProd = process.argv.includes('--prod')

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: 'dist/alertapp.user.js',
  banner: { js: banner },
  minify: isProd,
  sourcemap: isProd ? false : 'inline',
})

if (isWatch) {
  await ctx.watch()
  console.log('[esbuild] watching...')
} else {
  await ctx.rebuild()
  await ctx.dispose()
  console.log('[esbuild] build complete → dist/alertapp.user.js')
}
