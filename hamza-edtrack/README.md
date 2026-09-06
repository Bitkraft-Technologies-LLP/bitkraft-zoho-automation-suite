# Hamza EdTrack

A personal Google Apps Script tool for tracking Hamza's (Grade 5, IB curriculum)
Maths and English test performance: generate papers from a seeded question
bank, grade photographed answer sheets with Claude's vision API, and track
progress by strand over time. Runs entirely on Google's free stack.

## Stack

- Google Apps Script (V8 runtime), bound to a Google Sheet.
- Plain HTML/CSS/vanilla JS web app (`HtmlService` + `google.script.run`), no build step.
- Anthropic API (`claude-sonnet-5`) via `UrlFetchApp` for vision-based grading.
- Chart.js (via CDN) on `<canvas>` for the Progress dashboard — chosen over the
  Apps Script `Charts` service because it renders client-side, is more
  responsive on a ~380px phone screen, and doesn't need a server round trip
  per redraw when switching subjects.

## File structure

```
hamza-edtrack/
  appsscript.json     — manifest: V8, OAuth scopes, web app access
  Code.gs              — doGet routing, sheet bootstrap, shared helpers, Config
  QuestionBank.gs       — seed data (from seed/questions.json) + CRUD
  PaperGenerator.gs     — generatePaper(): sampling + Google Docs creation
  Grading.gs            — Anthropic vision grading + Results persistence
  Dashboard.gs          — progress aggregation for the Progress page
  Index.html            — nav shell
  Generate.html         — "Generate Paper" page
  Grade.html            — "Grade a Paper" page (camera capture + review table)
  Dashboard.html        — "Progress" page (Chart.js)
  Styles.html           — shared mobile-first CSS, pulled in via include()
  seed/questions.json   — the 51 seeded questions, parsed from the Term 1 papers
```

## Sheets schema (bound spreadsheet "Hamza EdTrack — Data")

- **QuestionBank** — id, subject, strand, sub_skill, difficulty, question_text, marks, answer_text, marking_notes, last_used_date, times_used
- **Papers** — paper_id, subject, term, created_date, total_marks, question_ids, doc_url_paper, doc_url_key
- **Results** — result_id, paper_id, student, date_taken, date_graded, question_id, strand, max_marks, marks_awarded, ai_notes, teacher_override
- **Config** — key, value (student name, default subject list, strand-weight templates)

## One-time setup

1. **Set the Anthropic API key** (never committed to the repo):
   Apps Script editor → ⚙️ **Project Settings** → **Script Properties** →
   **Add script property** → name `ANTHROPIC_API_KEY`, value = your key.

2. **Seed the question bank**: in the Apps Script editor, select the
   `seedQuestionBank` function and click Run once. Check **View → Logs** for
   the per-subject/strand count summary, and check the `QuestionBank` tab in
   the Sheet to confirm the rows landed.

3. **Deploy the web app** (see below) and open the `/exec` URL it prints.

## Sharing

The web app is deployed with `executeAs: USER_DEPLOYING` and
`access: ANYONE_ANONYMOUS` — anyone with the `/exec` link can open it, but it
always reads/writes the one bound Sheet as the deploying Google account.
There's no login screen. This is the simplest option for a single-family,
single-student tool; if that's ever a concern, tighten `webapp.access` in
`appsscript.json` to `DOMAIN` or `MYSELF` and redeploy.

## Notes on grading

- Photos are base64-encoded in the browser, sent to `gradeSubmission()`, used
  for exactly one Anthropic API call, and then discarded — they are never
  written to the Sheet or Drive.
- The AI's first pass is never final: the Grade page shows an editable marks
  column before anything is saved. Saving only flips `teacher_override` to
  `true` on rows whose mark was actually changed.
