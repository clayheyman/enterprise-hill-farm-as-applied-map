// Minimal ZIP reader built on Node's built-in zlib (no third-party deps).
// .xlsx files are just ZIP archives, so this is enough to pull specific
// entries (xl/sharedStrings.xml, xl/worksheets/sheet1.xml, etc.) out of one.

'use strict';

const zlib = require('zlib');

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/**
 * Parse a Buffer containing a ZIP file into a Map of filename -> Buffer (decompressed).
 * Only supports "stored" (0) and "deflate" (8) compression, which covers every
 * .xlsx writer in practice.
 */
function readZip(buffer) {
  const eocdOffset = findEOCD(buffer);
  if (eocdOffset === -1) {
    throw new Error('Not a valid zip/xlsx file (no end-of-central-directory record found)');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  let offset = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== CEN_SIG) {
      throw new Error(`Corrupt zip: expected central directory signature at offset ${offset}`);
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);

    entries.set(name, {
      compressionMethod,
      compressedSize,
      localHeaderOffset,
    });

    offset += 46 + nameLen + extraLen + commentLen;
  }

  const files = new Map();
  for (const [name, meta] of entries) {
    files.set(name, () => extractEntry(buffer, meta));
  }
  return files;
}

function extractEntry(buffer, meta) {
  const { localHeaderOffset, compressionMethod, compressedSize } = meta;
  const sig = buffer.readUInt32LE(localHeaderOffset);
  if (sig !== LOC_SIG) {
    throw new Error(`Corrupt zip: expected local file header signature at offset ${localHeaderOffset}`);
  }
  const nameLen = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLen = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLen + extraLen;
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) return Buffer.from(compressed);
  if (compressionMethod === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`Unsupported zip compression method: ${compressionMethod}`);
}

function findEOCD(buffer) {
  // EOCD is near the end of the file; scan backwards (comment field can push it back further).
  const maxScan = Math.min(buffer.length, 65557); // max comment length (65535) + EOCD size (22)
  const start = buffer.length - maxScan;
  for (let i = buffer.length - 22; i >= start; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

module.exports = { readZip };
