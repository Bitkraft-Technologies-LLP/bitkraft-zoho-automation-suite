/**
 * PaperGenerator.gs — samples QuestionBank into a new paper instance and
 * generates the paper + answer-key Google Docs.
 */

var STRAND_ORDER = {
  Mathematics: ['Mental Maths', 'Large Numbers', 'Addition, Subtraction & Integers', 'Time & Money', 'Shape & Space'],
  English: ['Reading Comprehension', 'Grammar & Spelling', 'Letter Writing', 'Descriptive Writing'],
  Hindi: ['Comprehension', 'Grammar', 'Creative Writing'],
  Marathi: ['Reading & Comprehension', 'Grammar', 'Writing']
};

/**
 * config: { subject, term, totalMarks, mode: 'auto'|'manual', strandTargets: {strand: marks} (manual only) }
 * Returns { paperId, subject, term, totalMarks, docUrlPaper, docUrlKey, strandBreakdown }.
 */
function generatePaper(config) {
  var subject = config.subject;
  var term = config.term || 'Term 1';
  var totalMarks = Number(config.totalMarks) || 60;
  var strandOrder = STRAND_ORDER[subject] || Object.keys(getStrandWeights_(subject));

  var targets = config.mode === 'manual' && config.strandTargets
    ? config.strandTargets
    : computeAutoStrandTargets_(subject, totalMarks, strandOrder);

  var chosenIds = [];
  var strandBreakdown = [];

  strandOrder.forEach(function (strand) {
    var target = Number(targets[strand]) || 0;
    if (target <= 0) return;
    var candidates = getQuestionsBySubject_(subject).filter(function (q) { return q.strand === strand; });
    var picked = pickQuestionsForTarget_(candidates, target);
    var achieved = picked.reduce(function (sum, q) { return sum + Number(q.marks); }, 0);
    picked.forEach(function (q) { chosenIds.push(q.id); });
    strandBreakdown.push({ strand: strand, target: target, achieved: achieved, count: picked.length });
  });

  var orderedQuestions = getQuestionsByIds_(chosenIds).sort(function (a, b) {
    var strandDiff = strandOrder.indexOf(a.strand) - strandOrder.indexOf(b.strand);
    if (strandDiff !== 0) return strandDiff;
    return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  });

  var achievedTotal = orderedQuestions.reduce(function (sum, q) { return sum + Number(q.marks); }, 0);
  var paperId = generatePaperId_(subject);

  var paperDoc = buildPaperDoc_(paperId, subject, term, orderedQuestions, strandOrder);
  var keyDoc = buildAnswerKeyDoc_(paperId, subject, term, orderedQuestions, strandOrder);

  var sheet = getSheet_(SHEET_PAPERS);
  sheet.appendRow([
    paperId, subject, term, todayString_(), achievedTotal,
    orderedQuestions.map(function (q) { return q.id; }).join(','),
    paperDoc.getUrl(), keyDoc.getUrl()
  ]);

  markQuestionsUsed_(chosenIds);

  return {
    paperId: paperId,
    subject: subject,
    term: term,
    totalMarks: achievedTotal,
    docUrlPaper: paperDoc.getUrl(),
    docUrlKey: keyDoc.getUrl(),
    strandBreakdown: strandBreakdown
  };
}

/** Exposed to the Generate page so manual strand sliders can be built with sensible defaults. */
function getStrandsForSubject(subject) {
  var order = STRAND_ORDER[subject] || Object.keys(getStrandWeights_(subject));
  var weights = getStrandWeights_(subject);
  return order.map(function (strand) { return { strand: strand, defaultWeight: Number(weights[strand]) || 0 }; });
}

function getStrandWeights_(subject) {
  var raw = getConfigValue_('strand_weights_' + subject, '{}');
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

/** Scales the syllabus-weight template proportionally to totalMarks, fixing rounding on the largest strand. */
function computeAutoStrandTargets_(subject, totalMarks, strandOrder) {
  var weights = getStrandWeights_(subject);
  var weightSum = strandOrder.reduce(function (s, strand) { return s + (Number(weights[strand]) || 0); }, 0);
  if (weightSum === 0) throw new Error('No strand weights configured for ' + subject);

  var targets = {};
  var runningTotal = 0;
  var largestStrand = strandOrder[0];
  strandOrder.forEach(function (strand) {
    var w = Number(weights[strand]) || 0;
    var t = Math.round((w / weightSum) * totalMarks);
    targets[strand] = t;
    runningTotal += t;
    if (w > (weights[largestStrand] || 0)) largestStrand = strand;
  });
  targets[largestStrand] += (totalMarks - runningTotal);
  return targets;
}

/**
 * Ranks candidates by staleness (older last_used_date / lower times_used first),
 * then tries to hit `target` marks exactly via subset-sum over that priority
 * order (bitmask search — candidate pools here are small, so this is cheap).
 * Falls back to a greedy best-effort selection if no exact combination exists.
 */
function pickQuestionsForTarget_(candidates, target) {
  var ranked = candidates.slice().sort(function (a, b) {
    var usedDiff = (Number(a.times_used) || 0) - (Number(b.times_used) || 0);
    if (usedDiff !== 0) return usedDiff;
    var da = a.last_used_date ? String(a.last_used_date) : '';
    var db = b.last_used_date ? String(b.last_used_date) : '';
    if (da !== db) return da < db ? -1 : 1;
    return Math.random() - 0.5;
  });

  var exact = findExactSubset_(ranked, target);
  if (exact) return exact;
  return greedyFallback_(ranked, target);
}

function findExactSubset_(items, target) {
  var n = items.length;
  if (n === 0 || n > 20) return null;
  var best = null;
  var bestScore = -1;
  for (var mask = 1; mask < (1 << n); mask++) {
    var sum = 0;
    for (var i = 0; i < n; i++) {
      if (mask & (1 << i)) sum += Number(items[i].marks);
    }
    if (sum !== target) continue;
    var score = 0;
    for (var j = 0; j < n; j++) {
      if (mask & (1 << j)) score += (n - j);
    }
    if (score > bestScore) {
      bestScore = score;
      best = mask;
    }
  }
  if (best === null) return null;
  var chosen = [];
  for (var k = 0; k < n; k++) {
    if (best & (1 << k)) chosen.push(items[k]);
  }
  return chosen;
}

function greedyFallback_(ranked, target) {
  var chosen = [];
  var sum = 0;
  ranked.forEach(function (q) {
    var marks = Number(q.marks);
    if (sum + marks <= target) {
      chosen.push(q);
      sum += marks;
    }
  });
  return chosen;
}

function buildPaperDoc_(paperId, subject, term, questions, strandOrder) {
  var doc = DocumentApp.create('Hamza EdTrack - ' + subject + ' - ' + paperId + ' - Paper');
  var body = doc.getBody();
  var totalMarks = questions.reduce(function (s, q) { return s + Number(q.marks); }, 0);

  body.appendParagraph('Grade 5 — ' + term + ' Assessment').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(subject.toUpperCase()).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('Name: ______________________   Class & Section: __________   Date: __________');
  body.appendParagraph('Maximum Marks: ' + totalMarks);
  body.appendParagraph('Paper ID: ' + paperId);

  body.appendParagraph('General Instructions').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  var instructions = [
    'Read every question carefully before answering.',
    'Show all your working where relevant. Marks are given for method as well as the final answer.',
    'Use a ruler, protractor and sharp pencil for the geometry section, where applicable.',
    'Write clearly — answers are graded from a photo of this paper.'
  ];
  instructions.forEach(function (line) {
    body.appendListItem(line).setGlyphType(DocumentApp.GlyphType.NUMBER);
  });

  var byStrand = {};
  questions.forEach(function (q) {
    if (!byStrand[q.strand]) byStrand[q.strand] = [];
    byStrand[q.strand].push(q);
  });

  var qNum = 1;
  strandOrder.forEach(function (strand) {
    var qs = byStrand[strand];
    if (!qs || !qs.length) return;
    var strandMarks = qs.reduce(function (s, q) { return s + Number(q.marks); }, 0);
    body.appendParagraph('Section — ' + strand + ' (' + strandMarks + ' marks)').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    qs.forEach(function (q) {
      body.appendParagraph(qNum + '. ' + q.question_text + '  (' + q.marks + ')');
      body.appendParagraph('');
      qNum++;
    });
  });

  body.appendParagraph('— End of Paper —').setHeading(DocumentApp.ParagraphHeading.NORMAL);
  doc.saveAndClose();
  return doc;
}

function buildAnswerKeyDoc_(paperId, subject, term, questions, strandOrder) {
  var doc = DocumentApp.create('Hamza EdTrack - ' + subject + ' - ' + paperId + ' - Answer Key');
  var body = doc.getBody();

  body.appendParagraph('ANSWER KEY & MARKING SCHEME').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(subject + ' — ' + term + ' — ' + paperId).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('For parent / grading use only.');

  var byStrand = {};
  questions.forEach(function (q) {
    if (!byStrand[q.strand]) byStrand[q.strand] = [];
    byStrand[q.strand].push(q);
  });

  var qNum = 1;
  strandOrder.forEach(function (strand) {
    var qs = byStrand[strand];
    if (!qs || !qs.length) return;
    body.appendParagraph('Section — ' + strand).setHeading(DocumentApp.ParagraphHeading.HEADING3);
    var tableRows = [['Q', 'Marks', 'Correct Answer', 'Marking Notes', 'Marks Awarded']];
    qs.forEach(function (q) {
      tableRows.push([String(qNum), String(q.marks), q.answer_text, q.marking_notes, '']);
      qNum++;
    });
    var table = body.appendTable(tableRows);
    table.getRow(0).editAsText().setBold(true);
  });

  doc.saveAndClose();
  return doc;
}
