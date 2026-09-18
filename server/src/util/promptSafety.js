/**
 * Lightweight guards around TMS Agent prompt injection via file content.
 * Does not replace TMS-side hardening; catches common text patterns only.
 */

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /you\s+are\s+now\b/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  /show\s+(me\s+)?(the\s+)?system\s+prompt/i,
  /print\s+(your\s+)?(system\s+)?prompt/i,
  /<\/?\s*glossary\s*>/i,
  /<\/?\s*system\s*>/i,
  /<\/?\s*instructions?\s*>/i,
  /\bDAN\s+mode\b/i,
  /override\s+(your\s+)?(safety|system)\b/i,
];

const LEAK_PATTERNS = [
  /system\s+prompt\s*:/i,
  /you\s+are\s+an?\s+ai\s+translation/i,
  /available\s+tools?\s*:/i,
  /network[- ]capable/i,
  /here\s+is\s+(my|the)\s+system\s+prompt/i,
  /\bPWNED\b/,
];

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'html', 'htm', 'xhtml', 'xml', 'json',
  'yaml', 'yml', 'xliff', 'xlf', 'sdlxliff', 'mqxliff', 'mxliff', 'po', 'properties',
  'srt', 'vtt', 'sbv', 'sub', 'ini', 'lang', 'resx', 'strings', 'dita', 'asciidoc',
  'adoc', 'asc', 'wiki',
]);

function fileExt(name) {
  const parts = String(name || '').toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

function readableSample(buffer, max = 500_000) {
  if (!buffer || !buffer.length) return '';
  const slice = buffer.subarray(0, Math.min(buffer.length, max));
  return slice.toString('utf8');
}

function findMatchingPattern(text, patterns) {
  if (!text) return null;
  for (const re of patterns) {
    if (re.test(text)) return re.source;
  }
  return null;
}

/** @returns {{ ok: true } | { ok: false, error: string }} */
function scanUploadForPromptInjection(buffer, fileName) {
  const text = readableSample(buffer);
  const hit = findMatchingPattern(text, INJECTION_PATTERNS);
  if (hit) {
    return {
      ok: false,
      error: `${fileName || 'This file'} looks unsafe to translate. Remove hidden instructions and try again.`,
    };
  }
  return { ok: true };
}

/**
 * Rough source-word estimate for early quota checks.
 * Returns null when we cannot estimate (binary / office) — caller skips early gate.
 */
function estimateUploadWords(buffer, fileName) {
  if (!buffer || !buffer.length) return 0;
  const ext = fileExt(fileName);
  if (TEXT_EXTS.has(ext)) {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    return text.split(/\s+/).filter(Boolean).length;
  }
  const sample = readableSample(buffer, 1_000_000);
  const tokens = sample.match(/[A-Za-z\u00C0-\u024F\u0600-\u06FF]{3,}/g) || [];
  if (tokens.length >= 80) return Math.ceil(tokens.length * 1.25);
  return null;
}

/** @returns {{ ok: true } | { ok: false, error: string }} */
function scanDownloadForPromptLeak(buffer, fileName) {
  const ext = fileExt(fileName);
  // Only scan clearly textual downloads; binary Office may false-positive on zip noise.
  if (!TEXT_EXTS.has(ext)) return { ok: true };
  const text = readableSample(buffer);
  const hit = findMatchingPattern(text, LEAK_PATTERNS);
  if (hit) {
    return {
      ok: false,
      error: 'Translation output looked unsafe and was blocked. Try again with clean source text.',
    };
  }
  return { ok: true };
}

module.exports = {
  scanUploadForPromptInjection,
  scanDownloadForPromptLeak,
  estimateUploadWords,
  TEXT_EXTS,
};
