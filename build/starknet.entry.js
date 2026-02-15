/**
 * Starknet.js Browser Bundle — Minimal Entry Point
 *
 * Exports ONLY the cryptographic primitives needed for:
 *   - ECDSA key derivation & signing (ec)
 *   - Poseidon / Keccak hashing (hash)
 *   - BigInt ↔ hex conversions (num)
 *   - Secure key generation with grinding (stark)
 *
 * Build:  npm run build:starknet
 * Output: public/home/plugin/starknet.bundle.min.js
 * Usage:  <script src="/home/plugin/starknet.bundle.min.js"></script>
 *         → exposes window.StarknetLib.{ ec, hash, num, stark }
 */
export { ec, hash, num, stark } from 'starknet';
