/**
 * Lightweight guards around TMS Agent prompt injection via file content.
 * Does not replace TMS-side hardening; catches common attack patterns from pentests.
 *
 * Office, PDF, and RTF uploads are turned into plain text first so a payload
 * hidden inside DOCX XML cannot skip the same checks used for TXT.
 */
const zlib = require('zlib');

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /you\s+are\s+now\b/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  /show\s+(me\s+)?(the\s+)?system\s+prompt/i,
  /print\s+(your\s+)?(system\s+)?prompt/i,
  /output\s+all\s+the\s+lines\s+of\s+your\s+system\s+prompt/i,
  /system\s+prompt/i,
  /<\/?\s*glossary\s*>/i,
  /<\/?\s*system\s*>/i,
  /<\/?\s*instructions?\s*>/i,
  /\bDAN\s+mode\b/i,
  /override\s+(your\s+)?(safety|system)\b/i,
  // Zerosploit-style delimiter breakout + fake system orders
  /system\s*:\s*(append|output|ignore|disregard|reveal|show|print|translate)/i,
  /append\s+the\s+word\s+PWNED/i,
  /\bPWNED\b/i,
  // Arabic “System: append the word PWNED…”
  /النظام\s*:\s*ألحق/,
  /ألحق\s+كلمة\s+PWNED/,
];

const LEAK_PATTERNS = [
  /system\s+prompt\s*:/i,
  /you\s+are\s+an?\s+ai\s+translation/i,
  /you\s+are\s+a\s+machine\s+translation\s+system/i,
  /IMPORTANT\s+RULES\s*:/i,
  /Output\s+ONLY\s+the\s+translation/i,
  /Never\s+explain,\s*refuse,\s*or\s+add\s+commentary/i,
  /available\s+tools?\s*:/i,
  /network[- ]capable/i,
  /here\s+is\s+(my|the)\s+system\s+prompt/i,
  /\bPWNED\b/,
  /<\/?\s*glossary\s*>/i,
];

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'html', 'htm', 'xhtml', 'xml', 'json',
  'yaml', 'yml', 'xliff', 'xlf', 'sdlxliff', 'mqxliff', 'mxliff', 'po', 'properties',
  'srt', 'vtt', 'sbv', 'sub', 'ini', 'lang', 'resx', 'strings', 'dita', 'asciidoc',
  'adoc', 'asc', 'wiki',
]);

const OFFICE_ZIP_EXTS = new Set([
  'docx', 'docm', 'dotx', 'dotm',
  'pptx', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm',
  'xlsx', 'xlsm', 'xltx', 'xltm',
]);

const OFFICE_TEXT_PART = /^(word\/(document|footnotes|endnotes|comments|header\d*|footer\d*)\.xml|ppt\/(slides\/slide\d+\.xml|notesSlides\/notesSlide\d+\.xml)|xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml))$/i;

function fileExt(name) {
  const parts = String(name || '').toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

function readableSample(buffer, max = 500_000) {
  if (!buffer || !buffer.length) return '';
  const slice = buffer.subarray(0, Math.min(buffer.length, max));
  // Normalize literal "\n" sequences often used in injection PoCs pasted as text.
  return slice.toString('utf8').replace(/\\n/g, '\n');
}

function findMatchingPattern(text, patterns) {
  if (!text) return null;
  for (const re of patterns) {
    re.lastIndex = 0;
    if (re.test(text)) return re.source;
  }
  return null;
}

/** Plain text from a ZIP package (DOCX / PPTX / XLSX), including deflated parts. */
function officeZipText(buffer) {
  if (!buffer || buffer.length < 30) return '';
  const chunks = [];
  let offset = 0;
  let parts = 0;
  while (offset + 30 <= buffer.length && parts < 80 && chunks.join('').length < 1_500_000) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    let compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > buffer.length) break;
    const name = buffer.subarray(nameStart, nameEnd).toString('utf8');
    let dataStart = nameEnd + extraLen;
    if (dataStart > buffer.length) break;
    if ((flags & 0x8) && compSize === 0) {
      const next = buffer.indexOf(Buffer.from([0x50, 0x4b]), dataStart);
      compSize = next > dataStart ? next - dataStart : buffer.length - dataStart;
    }
    const dataEnd = Math.min(buffer.length, dataStart + compSize);
    const data = buffer.subarray(dataStart, dataEnd);
    offset = dataEnd;
    if (!OFFICE_TEXT_PART.test(name)) continue;
    parts += 1;
    try {
      const raw = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
      if (raw && raw.length) chunks.push(raw.toString('utf8'));
    } catch {
      /* skip a bad part */
    }
  }
  return chunks.join('\n');
}

function pdfText(buffer) {
  if (!buffer || !buffer.length) return '';
  const chunks = [];
  const raw = buffer.toString('latin1');
  const literals = raw.match(/\((?:\\.|[^\\)]){4,}\)/g) || [];
  for (const lit of literals.slice(0, 400)) {
    chunks.push(lit.slice(1, -1).replace(/\\n/g, '\n').replace(/\\(.)/g, '$1'));
  }
  let i = 0;
  let streams = 0;
  while (streams < 25 && i < buffer.length && chunks.join('').length < 500_000) {
    const s = buffer.indexOf('stream', i);
    if (s < 0) break;
    let start = s + 6;
    if (buffer[start] === 0x0d) start += 1;
    if (buffer[start] === 0x0a) start += 1;
    const end = buffer.indexOf('endstream', start);
    if (end < 0) break;
    const chunk = buffer.subarray(start, end);
    streams += 1;
    i = end + 9;
    try {
      chunks.push(zlib.inflateSync(chunk).toString('utf8'));
    } catch {
      try {
        chunks.push(zlib.inflateRawSync(chunk).toString('utf8'));
      } catch {
        /* not a flate stream */
      }
    }
  }
  return chunks.join('\n');
}

function rtfText(buffer) {
  if (!buffer || !buffer.length) return '';
  let s = buffer.toString('latin1');
  s = s.replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\par[d]?/gi, '\n').replace(/\\[a-z]+-?\d* ?/gi, ' ');
  return s.replace(/[{}]/g, ' ');
}

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/<[^>]{0,400}>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : ' ';
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      return Number.isFinite(n) ? String.fromCodePoint(n) : ' ';
    });
}

/** Same visible text for TXT, Office, PDF, and RTF before injection / leak checks. */
function canonicalText(buffer, fileName) {
  const ext = fileExt(fileName);
  const parts = [readableSample(buffer)];
  if (OFFICE_ZIP_EXTS.has(ext)) parts.push(officeZipText(buffer));
  else if (ext === 'pdf') parts.push(pdfText(buffer));
  else if (ext === 'rtf') parts.push(rtfText(buffer));
  return decodeXmlEntities(parts.filter(Boolean).join('\n')).replace(/\\n/g, '\n');
}

/** @returns {{ ok: true } | { ok: false, error: string }} */
function scanUploadForPromptInjection(buffer, fileName) {
  const text = canonicalText(buffer, fileName);
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
 * Text files: whitespace split. Other types: readable tokens + size ceiling
 * so oversized Office uploads can be refused before a TMS job starts.
 */
function estimateUploadWords(buffer, fileName) {
  if (!buffer || !buffer.length) return 0;
  const ext = fileExt(fileName);
  if (TEXT_EXTS.has(ext) || ext === 'rtf') {
    const text = canonicalText(buffer, fileName).replace(/^\uFEFF/, '');
    return text.split(/\s+/).filter(Boolean).length;
  }
  const extracted = OFFICE_ZIP_EXTS.has(ext) || ext === 'pdf' ? canonicalText(buffer, fileName) : '';
  const fromExtracted = extracted ? extracted.split(/\s+/).filter(Boolean).length : 0;
  const sample = readableSample(buffer, 1_000_000);
  const tokens = sample.match(/[A-Za-z\u00C0-\u024F\u0600-\u06FF]{3,}/g) || [];
  const fromTokens = tokens.length ? Math.ceil(tokens.length * 1.25) : 0;
  // Loose upper bound from bytes (compressed Office/PDF). Prefers blocking over-quota starts.
  const fromSize = Math.ceil(buffer.length / 50);
  return Math.max(fromExtracted, fromTokens, fromSize);
}

/** @returns {{ ok: true } | { ok: false, error: string }} */
function scanDownloadForPromptLeak(buffer, fileName) {
  const ext = fileExt(fileName);
  const textual = TEXT_EXTS.has(ext) || OFFICE_ZIP_EXTS.has(ext) || ext === 'pdf' || ext === 'rtf';
  if (!textual) return { ok: true };
  const text = canonicalText(buffer, fileName);
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
