/**
 * Hamza EdTrack — shared bootstrap, routing, and small helpers used by every
 * other .gs file. Keep this file free of feature-specific logic.
 */

var SHEET_QUESTIONBANK = 'QuestionBank';
var SHEET_PAPERS = 'Papers';
var SHEET_RESULTS = 'Results';
var SHEET_CONFIG = 'Config';

var SHEET_HEADERS = {};
SHEET_HEADERS[SHEET_QUESTIONBANK] = ['id', 'subject', 'strand', 'sub_skill', 'difficulty', 'question_text', 'marks', 'answer_text', 'marking_notes', 'last_used_date', 'times_used'];
SHEET_HEADERS[SHEET_PAPERS] = ['paper_id', 'subject', 'term', 'created_date', 'total_marks', 'question_ids', 'doc_url_paper', 'doc_url_key'];
SHEET_HEADERS[SHEET_RESULTS] = ['result_id', 'paper_id', 'student', 'date_taken', 'date_graded', 'question_id', 'strand', 'max_marks', 'marks_awarded', 'ai_notes', 'teacher_override'];
SHEET_HEADERS[SHEET_CONFIG] = ['key', 'value'];

var DEFAULT_CONFIG = {
  student_name: 'Hamza',
  default_subjects: 'Mathematics,English,Hindi,Marathi',
  strand_weights_Mathematics: JSON.stringify({
    'Mental Maths': 10,
    'Large Numbers': 10,
    'Addition, Subtraction & Integers': 13,
    'Time & Money': 12,
    'Shape & Space': 15
  }),
  strand_weights_English: JSON.stringify({
    'Reading Comprehension': 15,
    'Grammar & Spelling': 25,
    'Letter Writing': 10,
    'Descriptive Writing': 10
  }),
  // Hindi and Marathi cover only the written-paper strands from the Term 1 Learning
  // Expectations doc — oral/recitation work is assessed separately and isn't testable
  // from a photographed answer sheet.
  strand_weights_Hindi: JSON.stringify({
    'Comprehension': 15,
    'Grammar': 15,
    'Creative Writing': 10
  }),
  strand_weights_Marathi: JSON.stringify({
    'Reading & Comprehension': 15,
    'Grammar': 15,
    'Writing': 10
  })
};

/**
 * Web app entry point. Routes ?page=generate|grade|dashboard|index to the
 * matching template. A full page load per tab keeps this simple and robust
 * on a phone browser instead of building an SPA router.
 */
function doGet(e) {
  ensureSheets_();
  var pages = { index: 'Index', generate: 'Generate', grade: 'Grade', dashboard: 'Progress', draft: 'Draft' };
  var page = (e && e.parameter && e.parameter.page) || 'index';
  var file = pages[page] || 'Index';
  return HtmlService.createTemplateFromFile(file)
    .evaluate()
    .setTitle('Hamza EdTrack')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * The canonical /exec URL for this deployment. Nav links must use this
 * (with target="_top") rather than a relative "?page=..." href — a relative
 * link clicked inside Apps Script's sandboxed content iframe resolves
 * against the iframe's own googleusercontent.com URL and navigates that
 * iframe in place, which does not fully re-render (blank page, no JS error).
 * A real top-level navigation back to this URL reloads correctly every time.
 */
function getWebAppUrl_() {
  return ScriptApp.getService().getUrl();
}

/** Lets HTML templates pull in shared partials via <?!= include('File') ?>. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Creates any missing tabs with headers, and seeds Config defaults. Safe to call repeatedly. */
function ensureSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_HEADERS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    if (sheet.getLastRow() === 0) {
      var headers = SHEET_HEADERS[name];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  });
  seedConfigDefaults_();
}

/** Only writes a Config key if it isn't already present, so manual edits in the Sheet stick. */
function seedConfigDefaults_() {
  var sheet = getSheet_(SHEET_CONFIG);
  var existing = getConfigMap_();
  var rows = [];
  Object.keys(DEFAULT_CONFIG).forEach(function (key) {
    if (!(key in existing)) {
      rows.push([key, DEFAULT_CONFIG[key]]);
    }
  });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
  }
}

function getSheet_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error('Sheet not found: ' + name + '. Run ensureSheets_() first.');
  }
  return sheet;
}

/** Reads the whole Config tab into a plain {key: value} object. */
function getConfigMap_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var map = {};
  values.forEach(function (row) {
    if (row[0]) map[row[0]] = row[1];
  });
  return map;
}

function getConfigValue_(key, fallback) {
  var map = getConfigMap_();
  return key in map ? map[key] : fallback;
}

/**
 * Google Sheets silently auto-converts a date-looking string (e.g. the
 * "2026-09-07" written by todayString_()) into a real Date-typed cell.
 * google.script.run can fail to serialize a Date object in its return
 * value — the browser then receives `null` from an otherwise-successful
 * call, with no error thrown anywhere. Every value read from a sheet goes
 * through this to convert Dates back to plain strings before they can ever
 * reach a client-facing return value.
 */
function normalizeSheetValue_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd');
  }
  return value;
}

/** Reads every data row of a sheet as an array of objects keyed by its header row. */
function readSheetAsObjects_(name) {
  var sheet = getSheet_(name);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = normalizeSheetValue_(row[i]); });
    return obj;
  });
}

function subjectCode_(subject) {
  return subject.toUpperCase().indexOf('MATH') === 0 ? 'MATH' : subject.substring(0, 3).toUpperCase();
}

/** e.g. MATH-2026-09-15-01 — date-scoped with a same-day sequence suffix. */
function generatePaperId_(subject) {
  var tz = Session.getScriptTimeZone() || 'Asia/Kolkata';
  var datePart = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var prefix = subjectCode_(subject) + '-' + datePart;
  var existing = readSheetAsObjects_(SHEET_PAPERS)
    .map(function (p) { return String(p.paper_id); })
    .filter(function (id) { return id.indexOf(prefix) === 0; });
  var seq = existing.length + 1;
  return prefix + '-' + (seq < 10 ? '0' + seq : seq);
}

function generateResultId_() {
  return 'RES-' + Utilities.getUuid();
}

function getStudentName() {
  return getConfigValue_('student_name', 'Hamza');
}

function todayString_() {
  var tz = Session.getScriptTimeZone() || 'Asia/Kolkata';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}
