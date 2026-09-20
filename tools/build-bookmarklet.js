// Generates the one-line `javascript:...` bookmarklet from
// talos-sync-bookmarklet.js, filling in the deployed sync URL and token.
//
// Usage:
//   node tools/build-bookmarklet.js <sync-url> <field-sync-token>
//
// Example:
//   node tools/build-bookmarklet.js \
//     https://enterprise-hill-farm-as-applied.onrender.com/api/admin/field-library/sync \
//     the-value-of-FIELD_SYNC_TOKEN
//
// Prints the bookmarklet text to paste into a new browser bookmark's URL field.

'use strict';

const fs = require('fs');
const path = require('path');

const [, , syncUrl, token] = process.argv;

if (!syncUrl || !token) {
  console.error('Usage: node tools/build-bookmarklet.js <sync-url> <field-sync-token>');
  process.exit(1);
}

const srcPath = path.join(__dirname, 'talos-sync-bookmarklet.js');
let src = fs.readFileSync(srcPath, 'utf8');

// Strip the leading comment block (everything before the IIFE) and collapse
// whitespace -- keeps the bookmarklet short, which some browsers care about.
src = src.slice(src.indexOf('(function'));
src = src.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ').trim();

src = src.replace('__TOKEN__', token).replace('__SYNC_URL__', syncUrl);

const bookmarklet = `javascript:${encodeURIComponent(src)}`;

console.log(bookmarklet);
