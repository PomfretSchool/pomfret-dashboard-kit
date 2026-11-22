/**
 * Pomfret dashboard: server side. Reads the Google Sheet this script is attached to.
 * The page only ever receives the columns listed in COLUMNS; everything else stays in the Sheet.
 */
const TITLE = 'Dashboard';
const TAB = '';        // tab name; blank = first tab
const COLUMNS = [];    // header names the page may see (required)

function doGet() {
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle(TITLE + ' · Pomfret')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Called from the page via google.script.run. Returns header row + data rows, as displayed in the Sheet. */
function getRows() {
  if (!COLUMNS.length) throw new Error('COLUMNS is empty: list the Sheet headers this dashboard needs in Code.js.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = TAB ? ss.getSheetByName(TAB) : ss.getSheets()[0];
  if (!sh) throw new Error('No tab named "' + TAB + '" in the Sheet.');
  const rows = sh.getDataRange().getDisplayValues();
  const head = rows[0].map((h) => h.trim());
  const idx = COLUMNS.map((c) => head.indexOf(c));
  const missing = COLUMNS.filter((c, i) => idx[i] === -1);
  if (missing.length) throw new Error('The Sheet is missing column(s): ' + missing.join(', ') + '. Was a header renamed?');
  return rows.map((r) => idx.map((i) => r[i]));
}
