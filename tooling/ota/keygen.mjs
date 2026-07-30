#!/usr/bin/env node
// Generates the server-OTA code-signing keypair (docs/release/server-ota.md).
//
//   node tooling/ota/keygen.mjs
//
// Prints both halves, base64-wrapped so they paste cleanly into GitHub / Portainer:
//   TRM_OTA_SIGNING_KEY     → repo SECRET (CI signs the manifest with it). Never commit it.
//   TRM_SELFUPDATE_PUBLIC_KEY → the deployment's env (the server verifies with it). Public.
//
// Rotating: set the new public key on the deployment FIRST, then swap the CI secret. A deployment
// only ever accepts manifests signed by the key it holds, so the order matters — the other way round
// leaves every bundle rejected until the deployment catches up.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pem = (key, type) => key.export({ type, format: 'pem' }).toString();

console.log('# repo secret — CI only, never commit');
console.log(`TRM_OTA_SIGNING_KEY=${Buffer.from(pem(privateKey, 'pkcs8')).toString('base64')}`);
console.log('');
console.log('# deployment env — public, safe to paste anywhere');
console.log(`TRM_SELFUPDATE_PUBLIC_KEY=${Buffer.from(pem(publicKey, 'spki')).toString('base64')}`);
