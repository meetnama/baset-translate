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

/**
 * Keeps browser-provided names useful while making them safe as output paths
 * and ZIP entry names on both Windows and Linux.
 */
function safeDownloadFilename(name, fallback = 'translated-file') {
  const base = decodeMultipartFilename(name)
    .replace(/^.*[\\/]/, '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!base) return fallback;
  return base.slice(0, 180);
}

module.exports = { decodeMultipartFilename, safeDownloadFilename };
