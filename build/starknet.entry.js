/**
 * Starknet.js Browser Bundle — Minimal Entry Point
 *
 * Exports ONLY the cryptographic primitives needed for:
 *   - ECDSA key derivation & signing (ec)
 *   - Poseidon / Keccak hashing (hash)
 *   - BigInt ↔ hex conversions (num)
 *   - Secure key generation with grinding (stark)
 *   - BIP-39 mnemonic seed phrase generation (bip39)
 *   - Stark key grinding from seed (grindKey)
 *
 * Build:  npm run build:starknet
 * Output: public/home/plugin/starknet.bundle.min.js
 * Usage:  <script src="/home/plugin/starknet.bundle.min.js"></script>
 *         → exposes window.StarknetLib.{ ec, hash, num, stark, bip39, grindKey }
 */
export { ec, hash, num, stark } from 'starknet';

// BIP-39 mnemonic support — 12-word seed phrases
export {
    generateMnemonic,
    mnemonicToEntropy,
    entropyToMnemonic,
    validateMnemonic,
} from '@scure/bip39';
export { wordlist as englishWordlist } from '@scure/bip39/wordlists/english';

// Stark key grinding — derives a valid Stark private key from arbitrary seed bytes
export { grindKey } from '@scure/starknet';
