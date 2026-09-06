/**
 * Grading.gs — sends photographed answer sheets to the Gemini API (see AI.gs)
 * for vision-based grading against the QuestionBank's answer/marking notes,
 * then persists the (editable) results.
 */

var GRADING_INSTRUCTION = 'You are grading a Grade 5 IB-curriculum test paper. You will see photos of a ' +
  "student's handwritten answers and the official answer key with marking notes. For each question, award " +
  'marks strictly per the marking notes (partial credit where the notes allow it), quote the exact text you ' +
  'read from the photo for that question, and briefly explain why marks were or were not given. If ' +
  'handwriting is unclear, say so rather than guessing. Respond with valid JSON only, no other text.';

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
