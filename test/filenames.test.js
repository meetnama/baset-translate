const test = require('node:test');
const assert = require('node:assert/strict');

const { safeDownloadFilename } = require('../server/src/util/filenames');

test('download filenames cannot introduce paths into generated output', () => {
  assert.equal(safeDownloadFilename('../../private/secret.docx'), 'secret.docx');
  assert.equal(safeDownloadFilename('C:\\private\\secret.docx'), 'secret.docx');
});

test('download filename sanitizing preserves valid Unicode names', () => {
  assert.equal(safeDownloadFilename('ترجمة نهائية.docx'), 'ترجمة نهائية.docx');
  assert.equal(safeDownloadFilename('...'), 'translated-file');
});
