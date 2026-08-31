/**
 * Multer/busboy often turns UTF-8 multipart filenames into Latin-1 mojibake
 * (Arabic, CJK, Cyrillic, accented Latin, etc.). Re-decode when needed.
 * Leave alone if the string is already proper Unicode (code points > 255).
 */
function decodeMultipartFilename(name) {
  const raw = String(name || '');
  if (!raw) return raw;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw.charCodeAt(i) > 255) return raw;
  }
  try {
    const fixed = Buffer.from(raw, 'latin1').toString('utf8');
    if (!fixed || fixed.includes('\uFFFD')) return raw;
    return fixed;
  } catch {
    return raw;
  }
}

module.exports = { decodeMultipartFilename };
