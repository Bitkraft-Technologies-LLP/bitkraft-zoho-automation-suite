/**
 * QuestionDrafter.gs — drafts new QuestionBank rows with the Gemini API (see AI.gs) so
 * the bank keeps growing (avoiding repeats) instead of being frozen at the
 * initial 51 seeded questions. Draft output is never saved automatically —
 * the Draft page shows it for review/edits first, same pattern as grading.
 *
 * Topics per strand are taken directly from the Grade 5 Term 1 Learning
 * Expectations document, not invented, so drafted questions stay syllabus-aligned.
 * Oral-only work (recitation, speaking) and non-written-test subjects
 * (Unit of Inquiry, Art) are intentionally excluded — there's nothing to
 * photograph and grade for those.
 */

var SYLLABUS_TOPICS = {
  Mathematics: {
    'Mental Maths': ['Quick recall across all Term 1 Maths topics below — short, no-working answers'],
    'Large Numbers': [
      'Indian place value system (crores) — number names & expanded form',
      'International place value system (hundred millions) — number names & expanded form',
      'Ascending and descending order of numbers',
      'Estimation & rounding off (nearest thousand)',
      'Roman numerals (up to 20)'
    ],
    'Addition, Subtraction & Integers': [
      'Addition & subtraction of large numbers (up to crores)',
      'Addition using the lattice method',
      'Word problems on addition & subtraction',
      'Estimation in operations on numbers',
      'Addition & subtraction of integers',
      'Comparison of integers'
    ],
    'Time & Money': [
      'Converting units of time',
      '24-hour and 12-hour clock conversion',
      'Addition & subtraction of time',
      'Operations on money'
    ],
    'Shape & Space': [
      'Types of lines',
      'Classifying angles',
      'Measurement of angles',
      'Types of triangles',
      'Symmetry in 3D shapes',
      'Rotation & reflection of 2D shapes',
      'Nets of 3D shapes'
    ]
  },
  English: {
    'Reading Comprehension': [
      'Seen comprehension', 'Unseen comprehension', 'Summarizing',
      'Analyzing character, setting and plot', 'Inferencing', 'Drawing conclusions'
    ],
    'Grammar & Spelling': [
      'Punctuation (full stop, comma, question mark, apostrophe, exclamation mark, quotation mark)',
      'Parts of speech', 'Affirmative and negative sentences',
      'Degrees of comparison of adjectives', 'Interjections', 'Relative pronouns',
      'Adverbs and their types', 'Oxford Nelson spelling (units 1-8 level)'
    ],
    'Letter Writing': ['Writing an informal letter', 'Writing a formal letter'],
    'Descriptive Writing': ['Writing a paragraph / descriptive writing']
  },
  Hindi: {
    'Comprehension': ['अपठित गद्यांश (unseen passage)'],
    'Grammar': [
      'संज्ञा (noun)', 'सर्वनाम (pronoun)', 'पर्यायवाची (synonyms)',
      'विलोम (antonyms)', 'लिंग (gender)', 'वचन (singular/plural)', 'गिनती १-५० (counting 1-50)'
    ],
    'Creative Writing': ['अनुच्छेद लेखन (paragraph writing)']
  },
  Marathi: {
    'Reading & Comprehension': ['कथा श्रावण बाळाची (story-based reading)', 'आकलन (unseen passage comprehension)'],
    'Grammar': ['नाम (noun)', 'अंक अक्षर १ ते ५० (number names 1-50)'],
    'Writing': ['आली कोकणगाडी (poem-based writing)', 'चिमणीची हुशारी (story-based writing)']
  }
};

function getSyllabusTopics(subject, strand) {
  return (SYLLABUS_TOPICS[subject] && SYLLABUS_TOPICS[subject][strand]) || [];
}

var DRAFT_SYSTEM_PROMPT = 'You are an experienced Grade 5 IB-curriculum teacher setting new test questions. ' +
  'Match the style, length and rigor of a real Grade 5 Term 1 assessment: short direct-answer items at ' +
  'difficulty 1, standard multi-part items at difficulty 2, multi-step word problems or extended writing tasks ' +
  'at difficulty 3. Every question needs a fully worked correct answer and marking notes precise enough for a ' +
  'parent to award partial credit consistently. Respond with valid JSON only, no other text.';

/**
 * config: { subject, strand, count, difficulty (1-3) }
 * Returns an array of candidate questions for on-screen review — nothing is saved yet.
 */
function draftQuestions(config) {
  var subject = config.subject;
  var strand = config.strand;
  var count = Math.max(1, Math.min(Number(config.count) || 5, 15));
  var difficulty = Number(config.difficulty) || 2;
  var topics = getSyllabusTopics(subject, strand);
  if (!topics.length) throw new Error('No syllabus topics configured for ' + subject + ' — ' + strand);

  var existingTexts = getQuestionsBySubject_(subject)
    .filter(function (q) { return q.strand === strand; })
    .map(function (q) { return q.question_text; });

  var userPrompt = 'Subject: ' + subject + '\nStrand: ' + strand + '\n' +
    'Topics to draw from (use a mix, do not invent topics outside this list):\n- ' + topics.join('\n- ') + '\n\n' +
    'Write ' + count + ' NEW questions at difficulty ' + difficulty + ' (1=warm-up/recall, 2=standard, 3=multi-step/extended). ' +
    'Do not duplicate or lightly reword any of these existing questions:\n' +
    (existingTexts.length ? existingTexts.map(function (t) { return '- ' + t; }).join('\n') : '(none yet)') +
    '\n\nRespond with a JSON array only, in this exact schema: ' +
    '[{"question_text": "...", "marks": 0, "answer_text": "...", "marking_notes": "...", "sub_skill": "...", "difficulty": ' + difficulty + '}]';

  var text = callGemini_(DRAFT_SYSTEM_PROMPT, [{ text: userPrompt }]);
  var drafted = extractJsonArray_(text);
  if (!Array.isArray(drafted)) {
    throw new Error('Gemini did not return a question list — got: ' + JSON.stringify(drafted).substring(0, 300));
  }

  return drafted.map(function (q) {
    return {
      subject: subject,
      strand: strand,
      sub_skill: q.sub_skill || '',
      difficulty: Number(q.difficulty) || difficulty,
      question_text: q.question_text || '',
      marks: Number(q.marks) || 1,
      answer_text: q.answer_text || '',
      marking_notes: q.marking_notes || ''
    };
  });
}

/**
 * Drafts across every strand in one pass instead of picking one strand at a
 * time: `totalCount` questions are distributed proportional to each
 * strand's syllabus weight (same weights Generate Paper uses), then
 * draftQuestions() runs once per strand with its share. Returns the
 * combined candidate list (each question already tagged with its strand)
 * plus any per-strand failures, so a failure in one strand doesn't lose the
 * others' results.
 */
function autoDraftForSubject(subject, totalCount, difficulty) {
  var strands = getStrandsForSubject(subject);
  var weightSum = strands.reduce(function (s, x) { return s + x.defaultWeight; }, 0);
  if (weightSum === 0) throw new Error('No strand weights configured for ' + subject);

  var n = Math.max(strands.length, Math.min(Number(totalCount) || strands.length, 60));
  var allocations = strands.map(function (s) {
    return { strand: s.strand, count: Math.max(1, Math.round(n * s.defaultWeight / weightSum)) };
  });

  var drafted = [];
  var errors = [];
  allocations.forEach(function (a) {
    try {
      drafted = drafted.concat(draftQuestions({ subject: subject, strand: a.strand, count: a.count, difficulty: difficulty }));
    } catch (e) {
      errors.push({ strand: a.strand, message: e.message });
    }
  });

  return { drafted: drafted, errors: errors };
}

/**
 * Auto-fallback for the "avoid reuse" shortfall prompt on the Generate page:
 * when a strand doesn't have enough never-used marks to hit its target, this
 * drafts just enough new questions to cover the gap and saves them straight
 * to the bank (no manual review step — the parent already opted into this by
 * choosing "draft new questions" at the prompt). shortfalls: the array
 * returned by checkFreshQuestionAvailability().shortfalls.
 */
function draftForShortfalls(subject, shortfalls, difficulty) {
  var saved = [];
  var errors = [];
  (shortfalls || []).forEach(function (sf) {
    var strand = sf.strand;
    var existing = getQuestionsBySubject_(subject).filter(function (q) { return q.strand === strand; });
    var avgMarks = existing.length
      ? existing.reduce(function (s, q) { return s + Number(q.marks); }, 0) / existing.length
      : 2;
    var count = Math.max(2, Math.min(Math.ceil(sf.shortBy / avgMarks), 15));
    try {
      var drafted = draftQuestions({ subject: subject, strand: strand, count: count, difficulty: difficulty });
      var result = saveDraftedQuestions(subject, drafted);
      saved = saved.concat(drafted.map(function (q, i) { return { strand: strand, id: result.ids[i] }; }));
    } catch (e) {
      errors.push({ strand: strand, message: e.message });
    }
  });
  return { saved: saved, errors: errors };
}

/**
 * Appends parent-approved drafted questions to QuestionBank with freshly
 * generated ids. questions: array shaped like draftQuestions()'s output.
 */
function saveDraftedQuestions(subject, questions) {
  if (!questions || !questions.length) return { inserted: 0, ids: [] };
  var sheet = getSheet_(SHEET_QUESTIONBANK);
  var ids = [];
  var rows = questions.map(function (q) {
    var id = generateQuestionId_(subject);
    ids.push(id);
    return [id, subject, q.strand, q.sub_skill, q.difficulty, q.question_text, q.marks, q.answer_text, q.marking_notes, '', 0];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SHEET_HEADERS[SHEET_QUESTIONBANK].length).setValues(rows);
  return { inserted: rows.length, ids: ids };
}

/** e.g. HIN-06 — continues the numbering already used by that subject's ids. */
function generateQuestionId_(subject) {
  var prefix = subjectCode_(subject);
  var maxSeq = getAllQuestions_()
    .map(function (q) { return String(q.id); })
    .filter(function (id) { return id.indexOf(prefix + '-') === 0; })
    .map(function (id) { return parseInt(id.substring(prefix.length + 1), 10); })
    .filter(function (n) { return !isNaN(n); })
    .reduce(function (max, n) { return Math.max(max, n); }, 0);
  var next = maxSeq + 1;
  return prefix + '-' + (next < 10 ? '0' + next : next);
}
