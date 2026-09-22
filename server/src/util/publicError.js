/** User-facing error text. Keeps the real reason and strips vendor names. */

function scrub(text) {
  return String(text || '')
    .replace(/\bphrase\b/gi, 'translation service')
    .replace(/\bmemsource\b/gi, 'translation service')
    .replace(/[A-Z]:\\[^\s"']+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function publicErrorText(input, fallback) {
  let msg = scrub(input);
  if (!msg) return fallback;
  if (msg.length > 400) msg = `${msg.slice(0, 397)}...`;
  return msg;
}

function reasonFromBody(detail) {
  const raw = String(detail || '').trim();
  if (!raw || raw.startsWith('<')) return '';
  try {
    const data = JSON.parse(raw);
    const hit = [
      data.errorDescription,
      data.errorMessage,
      data.message,
      data.error,
      data.errorCode,
    ]
      .map((value) => (value == null ? '' : String(value).trim()))
      .find((value) => value.length > 0);
    return hit || '';
  } catch {
    return raw.length > 240 ? '' : raw;
  }
}

function upstreamErrorMessage(status, detail) {
  const reason = publicErrorText(reasonFromBody(detail), '');
  const code = status ? ` (${status})` : '';
  if (reason) return `The translation service rejected the request${code}: ${reason}`;
  return `The translation service rejected the request${code} and did not give a reason.`;
}

module.exports = { publicErrorText, upstreamErrorMessage, reasonFromBody };
