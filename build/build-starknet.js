#!/usr/bin/env node
/**
 * Build script — bundles starknet.js crypto primitives for browser use.
 *
 * Run:    npm run build:starknet
 * Output: public/home/plugin/starknet.bundle.min.js
 *
 * The bundle exposes `window.StarknetLib` with { ec, hash, num, stark }.
 * Only the modules needed for key derivation, signing, and wallet
 * generation are included — no RPC provider, contract, or account logic.
 */
const esbuild = require('esbuild');
const path = require('path');

const ENTRY = path.join(__dirname, 'starknet.entry.js');
const OUT = path.join(__dirname, '..', 'public', 'home', 'plugin', 'starknet.bundle.min.js');

esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'iife',
    globalName: 'StarknetLib',
    outfile: OUT,
    minify: true,
    platform: 'browser',
    target: ['es2020', 'chrome90', 'firefox90', 'safari14'],
    define: {
        'process.env.NODE_DEBUG': 'false',
        'global': 'globalThis',
    },
    treeShaking: true,
    logLevel: 'info',
}).then(() => {
    console.log(`\n  StarknetLib bundle → ${path.relative(process.cwd(), OUT)}`);
    console.log('  Exposes: window.StarknetLib.{ ec, hash, num, stark }\n');
}).catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
