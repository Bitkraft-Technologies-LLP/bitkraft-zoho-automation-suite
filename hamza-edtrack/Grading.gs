/**
 * Grading.gs — sends photographed answer sheets to the Gemini API (see AI.gs)
 * for vision-based grading against the QuestionBank's answer/marking notes,
 * then persists the (editable) results.
 */

var GRADING_INSTRUCTION = 'You are grading a Grade 5 IB-curriculum test paper. You will see photos of a ' +
  "student's handwritten answers and the official answer key with marking notes. For each question, award " +
  'marks strictly per the marking notes (partial credit where the notes explicitly allow it). ' +
  'Marks must be whole numbers, except where a marking note explicitly describes a half-mark increment ' +
  '(e.g. "½ each") — never award any other fractional or decimal value. ' +
  'For every question, quote the exact text you read from the photo in extracted_answer — this field must ' +
  'never be left empty; if you genuinely cannot find that question anywhere in the photos, set ' +
  'extracted_answer to "(not visible in the submitted photos)", award exactly 0 marks, and say so in ' +
  'reasoning. Never award any marks — partial or otherwise — for a question that is blank, not attempted, or ' +
  'not visible in the photos; only award marks for work you can actually see and read. If handwriting is ' +
  'unclear but present, say so in reasoning rather than guessing at the content. ' +
  'marks_awarded must be fully consistent with your own reasoning: if reasoning states an answer or part is ' +
  'fully correct, award that part\'s full marks per the marking notes — never adjust a score toward a middle ' +
  'value, hedge, or "compress" it for calibration reasons once you have judged it correct. ' +
  'Respond with valid JSON only, no other text.';

/**
 * images: [{ data: base64String, mimeType: 'image/jpeg' }, ...] in page order.
 * Returns { paperId, student, total, maxTotal, breakdown: [{result_id, question_id, strand,
 *   question_text, max_marks, marks_awarded, extracted_answer, reasoning}] }.
 */
function gradeSubmission(paperId, student, images) {
  if (!images || !images.length) throw new Error('At least one photo is required.');

  var paper = readSheetAsObjects_(SHEET_PAPERS).filter(function (p) { return p.paper_id === paperId; })[0];
  if (!paper) throw new Error('Paper not found: ' + paperId);

  var questionIds = String(paper.question_ids).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var questionsById = {};
  getQuestionsByIds_(questionIds).forEach(function (q) { questionsById[q.id] = q; });
  var orderedQuestions = questionIds.map(function (id) { return questionsById[id]; }).filter(Boolean);

  var aiResults = callGeminiForGrading_(orderedQuestions, images);

  // Re-grading the same paper for the same student replaces the previous
  // result rather than stacking on top of it — otherwise Past Submissions
  // and the Progress dashboard double-count every re-grade.
  deleteResultsForPaperStudent_(paperId, student);

  var today = todayString_();
  var resultsSheet = getSheet_(SHEET_RESULTS);
  var breakdown = [];
  var total = 0;
  var maxTotal = 0;

  orderedQuestions.forEach(function (q) {
    var ai = aiResults.filter(function (r) { return String(r.question_id) === String(q.id); })[0] || {};
    var marksAwarded = clampMarks_(Number(ai.marks_awarded) || 0, Number(q.marks));
    var resultId = generateResultId_();

    resultsSheet.appendRow([
      resultId, paperId, student, today, today, q.id, q.strand,
      q.marks, marksAwarded, ai.reasoning || '', false
    ]);

    total += marksAwarded;
    maxTotal += Number(q.marks);

    breakdown.push({
      result_id: resultId,
      question_id: q.id,
      strand: q.strand,
      question_text: q.question_text,
      max_marks: Number(q.marks),
      marks_awarded: marksAwarded,
      extracted_answer: ai.extracted_answer || '',
      reasoning: ai.reasoning || ''
    });
  });

  return { paperId: paperId, student: student, total: total, maxTotal: maxTotal, breakdown: breakdown };
}

/** Removes any existing Results rows for this exact paper+student before a (re-)grade writes fresh ones. */
function deleteResultsForPaperStudent_(paperId, student) {
  var sheet = getSheet_(SHEET_RESULTS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var headers = SHEET_HEADERS[SHEET_RESULTS];
  var paperCol = headers.indexOf('paper_id');
  var studentCol = headers.indexOf('student');
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (values[i][paperCol] === paperId && values[i][studentCol] === student) {
      sheet.deleteRow(i + 2);
    }
  }
}

/**
 * One-time cleanup, run manually from the Apps Script editor (function
 * dropdown → dedupeResultsOnce → Run): removes the duplicate Results rows
 * left behind before gradeSubmission() started replacing re-grades instead
 * of stacking them. For each (paper_id, student, question_id) combination,
 * keeps only the most recently appended row and deletes the rest.
 */
function dedupeResultsOnce() {
  var sheet = getSheet_(SHEET_RESULTS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { removed: 0 };
  var headers = SHEET_HEADERS[SHEET_RESULTS];
  var paperCol = headers.indexOf('paper_id');
  var studentCol = headers.indexOf('student');
  var questionCol = headers.indexOf('question_id');
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  var lastIndexForKey = {};
  values.forEach(function (row, i) {
    var key = row[paperCol] + '::' + row[studentCol] + '::' + row[questionCol];
    lastIndexForKey[key] = i; // later occurrences overwrite earlier ones — appendRow always adds at the bottom
  });

  var removed = 0;
  for (var i = values.length - 1; i >= 0; i--) {
    var key = values[i][paperCol] + '::' + values[i][studentCol] + '::' + values[i][questionCol];
    if (lastIndexForKey[key] !== i) {
      sheet.deleteRow(i + 2);
      removed++;
    }
  }
  Logger.log('dedupeResultsOnce: removed %s duplicate row(s).', removed);
  return { removed: removed };
}

function clampMarks_(value, max) {
  if (isNaN(value) || value < 0) return 0;
  return value > max ? max : value;
}

function callGeminiForGrading_(questions, images) {
  var bundle = questions.map(function (q) {
    return {
      question_id: q.id,
      question_text: q.question_text,
      max_marks: Number(q.marks),
      correct_answer: q.answer_text,
      marking_notes: q.marking_notes
    };
  });

  var parts = images.map(function (img) {
    return { inlineData: { mimeType: img.mimeType, data: img.data } };
  });
  parts.push({
    text: 'Questions, correct answers and marking notes for this paper (JSON):\n' + JSON.stringify(bundle) +
      '\n\nRespond with a JSON array only, in this exact schema: ' +
      '[{"question_id": "...", "marks_awarded": 0, "max_marks": 0, "extracted_answer": "...", "reasoning": "..."}]'
  });

  var text = callGemini_(GRADING_INSTRUCTION, parts);
  return extractJsonArray_(text);
}

/**
 * Applies teacher corrections after review. edits: [{result_id, marks_awarded}].
 * Only flips teacher_override to true for rows whose value actually changed.
 */
function saveGradingOverrides(edits) {
  var sheet = getSheet_(SHEET_RESULTS);
  var headers = SHEET_HEADERS[SHEET_RESULTS];
  var idCol = headers.indexOf('result_id') + 1;
  var marksCol = headers.indexOf('marks_awarded') + 1;
  var overrideCol = headers.indexOf('teacher_override') + 1;
  var dateGradedCol = headers.indexOf('date_graded') + 1;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { updated: 0 };

  var ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
  var editMap = {};
  edits.forEach(function (e) { editMap[e.result_id] = Number(e.marks_awarded); });

  var updated = 0;
  ids.forEach(function (row, i) {
    var resultId = row[0];
    if (!(resultId in editMap)) return;
    var sheetRow = i + 2;
    var currentValue = sheet.getRange(sheetRow, marksCol).getValue();
    var newValue = editMap[resultId];
    if (Number(currentValue) !== newValue) {
      sheet.getRange(sheetRow, marksCol).setValue(newValue);
      sheet.getRange(sheetRow, overrideCol).setValue(true);
      sheet.getRange(sheetRow, dateGradedCol).setValue(todayString_());
      updated++;
    }
  });

  return { updated: updated };
}

/** Populates the Papers dropdown on the Grade page. */
function listPapersForGrading() {
  return readSheetAsObjects_(SHEET_PAPERS)
    .sort(function (a, b) { return String(b.created_date).localeCompare(String(a.created_date)); })
    .map(function (p) {
      return { paper_id: p.paper_id, subject: p.subject, term: p.term, created_date: p.created_date, total_marks: p.total_marks };
    });
}

/** Populates the "Past Submissions" list on the Grade page — one row per graded paper attempt. */
function listGradedSubmissions() {
  var results = readSheetAsObjects_(SHEET_RESULTS);
  var paperInfo = {};
  readSheetAsObjects_(SHEET_PAPERS).forEach(function (p) { paperInfo[p.paper_id] = { subject: p.subject, term: p.term }; });

  var byAttempt = {};
  results.forEach(function (r) {
    var key = r.paper_id + '::' + r.student;
    if (!byAttempt[key]) {
      var info = paperInfo[r.paper_id] || {};
      byAttempt[key] = {
        paper_id: r.paper_id, student: r.student, subject: info.subject || '', term: info.term || '',
        date_taken: r.date_taken, date_graded: r.date_graded, awarded: 0, max: 0
      };
    }
    byAttempt[key].awarded += Number(r.marks_awarded);
    byAttempt[key].max += Number(r.max_marks);
    if (String(r.date_graded) > String(byAttempt[key].date_graded)) byAttempt[key].date_graded = r.date_graded;
  });

  return Object.keys(byAttempt).map(function (k) { return byAttempt[k]; })
    .sort(function (a, b) { return String(b.date_graded).localeCompare(String(a.date_graded)); });
}

/** Read (and re-editable) breakdown for one already-graded paper attempt, for the "View" action in Past Submissions. */
function getSubmissionDetail(paperId, student) {
  var results = readSheetAsObjects_(SHEET_RESULTS).filter(function (r) { return r.paper_id === paperId && r.student === student; });
  if (!results.length) throw new Error('No graded results found for ' + student + ' on ' + paperId);

  var questionsById = {};
  getQuestionsByIds_(results.map(function (r) { return r.question_id; })).forEach(function (q) { questionsById[q.id] = q; });

  var breakdown = results.map(function (r) {
    var q = questionsById[r.question_id];
    return {
      result_id: r.result_id,
      question_id: r.question_id,
      strand: r.strand,
      question_text: q ? q.question_text : '(question no longer in the bank)',
      max_marks: Number(r.max_marks),
      marks_awarded: Number(r.marks_awarded),
      extracted_answer: '',
      reasoning: r.ai_notes || ''
    };
  });

  return {
    paperId: paperId,
    student: student,
    total: breakdown.reduce(function (s, b) { return s + b.marks_awarded; }, 0),
    maxTotal: breakdown.reduce(function (s, b) { return s + b.max_marks; }, 0),
    breakdown: breakdown
  };
}
