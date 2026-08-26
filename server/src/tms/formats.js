/**
 * Canonical file extensions supported by TMS import.
 * Languages are loaded live from the API; extensions match the published TMS set.
 */
const TMS_FILE_EXTENSIONS = [
  // Microsoft Office
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pps', 'ppsx', 'pot', 'potx',
  // OpenOffice / LibreOffice
  'odt', 'ods', 'odp',
  // Text / markup
  'txt', 'csv', 'rtf', 'html', 'htm', 'xhtml', 'xml', 'md',
  // Bilingual / CAT
  'xliff', 'xlf', 'sdlxliff', 'mqxliff', 'ttx', 'txlf', 'mxliff',
  // Localization
  'po', 'pot', 'resx', 'resw', 'strings', 'stringsdict', 'properties',
  'json', 'yaml', 'yml', 'arb', 'ts', 'dita', 'ditamap',
  // DTP
  'idml', 'mif', 'inx',
  // Subtitles
  'srt', 'vtt', 'sbv', 'sub',
  // Other common
  'pdf', 'zip',
];

/** Fallback language list when live API is unavailable (mock or offline). */
const FALLBACK_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'en_us', name: 'English (United States)' },
  { code: 'en_gb', name: 'English (United Kingdom)' },
  { code: 'ar', name: 'Arabic' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'es_mx', name: 'Spanish (Mexico)' },
  { code: 'it', name: 'Italian' },
  { code: 'pt_br', name: 'Portuguese (Brazil)' },
  { code: 'pt_pt', name: 'Portuguese (Portugal)' },
  { code: 'nl', name: 'Dutch' },
  { code: 'ru', name: 'Russian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'pl', name: 'Polish' },
  { code: 'zh_cn', name: 'Chinese (Simplified)' },
  { code: 'zh_tw', name: 'Chinese (Traditional)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'hi', name: 'Hindi' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'cs', name: 'Czech' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'th', name: 'Thai' },
];

module.exports = { TMS_FILE_EXTENSIONS, FALLBACK_LANGUAGES };
