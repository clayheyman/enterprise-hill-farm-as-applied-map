// Tiny stand-in for the `dotenv` package (npm registry access isn't
// available in every environment this gets built/deployed from). Loads
// KEY=VALUE pairs from a .env file next to package.json into process.env,
// without overwriting variables the host environment already set.

'use strict';

const fs = require('fs');
const path = require('path');

function loadEnv(envPath = path.join(__dirname, '..', '..', '.env')) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  });
}

module.exports = { loadEnv };
