/**
 * Dashboard.gs — reads Results (joined against Papers for subject, and
 * QuestionBank indirectly via the strand already stored on each row) and
 * aggregates it into the shapes the Progress page renders.
 */

function getAvailableSubjects() {
  return getConfigValue_('default_subjects', 'Mathematics,English').split(',').map(function (s) { return s.trim(); });
}

/**
 * Returns { subject, timeSeries: [{paper_id, student, date, pct, awarded, max}],
 * strandStats: [{strand, attempts, rollingAvgPct, overallPct}], weakestStrands: [...top 3 lowest] }.
 */
function getDashboardData(subject) {
  var results = readSheetAsObjects_(SHEET_RESULTS);
  var papers = readSheetAsObjects_(SHEET_PAPERS);
  var paperSubject = {};
  papers.forEach(function (p) { paperSubject[p.paper_id] = p.subject; });

  var filtered = results.filter(function (r) { return paperSubject[r.paper_id] === subject; });

  var byPaper = {};
  filtered.forEach(function (r) {
    var key = r.paper_id + '::' + r.student;
    if (!byPaper[key]) byPaper[key] = { paper_id: r.paper_id, student: r.student, date: r.date_taken, awarded: 0, max: 0 };
    byPaper[key].awarded += Number(r.marks_awarded);
    byPaper[key].max += Number(r.max_marks);
  });
  var timeSeries = Object.keys(byPaper).map(function (k) {
    var p = byPaper[k];
    return {
      paper_id: p.paper_id, student: p.student, date: p.date,
      pct: p.max ? round1_(p.awarded / p.max * 100) : 0, awarded: p.awarded, max: p.max
    };
  }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });

  var byStrand = {};
  filtered.forEach(function (r) {
    if (!byStrand[r.strand]) byStrand[r.strand] = [];
    byStrand[r.strand].push(r);
  });
  var strandStats = Object.keys(byStrand).map(function (strand) {
    var rows = byStrand[strand].slice().sort(function (a, b) { return String(a.date_graded).localeCompare(String(b.date_graded)); });
    var recent = rows.slice(-5);
    var recentPct = recent.map(function (r) { return Number(r.max_marks) ? Number(r.marks_awarded) / Number(r.max_marks) * 100 : 0; });
    var rollingAvg = recentPct.length ? recentPct.reduce(function (a, b) { return a + b; }, 0) / recentPct.length : 0;
    var overallAwarded = rows.reduce(function (s, r) { return s + Number(r.marks_awarded); }, 0);
    var overallMax = rows.reduce(function (s, r) { return s + Number(r.max_marks); }, 0);
    return {
      strand: strand,
      attempts: rows.length,
      rollingAvgPct: round1_(rollingAvg),
      overallPct: overallMax ? round1_(overallAwarded / overallMax * 100) : 0
    };
  });

  var weakestStrands = strandStats.slice().sort(function (a, b) { return a.rollingAvgPct - b.rollingAvgPct; }).slice(0, 3);

  return { subject: subject, timeSeries: timeSeries, strandStats: strandStats, weakestStrands: weakestStrands };
}

function round1_(n) {
  return Math.round(n * 10) / 10;
}
