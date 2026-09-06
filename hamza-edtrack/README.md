# Hamza EdTrack

A personal Google Apps Script tool for tracking Hamza's (Grade 5, IB curriculum)
test performance across Maths, English, Hindi and Marathi: generate papers
from a question bank, grade photographed answer sheets with Claude's vision
API, keep growing the bank with AI-drafted questions, and track progress by
strand over time. Runs entirely on Google's free stack.

Unit of Inquiry and Art aren't covered — they're inquiry/craft-based rather
than question-and-answer written tests, so there's nothing to generate a
paper or grade a photo against. French is intentionally excluded per
Hamza's parent. Hindi and Marathi papers only cover their written strands
(comprehension, grammar, writing) — recitation and speaking are assessed
orally at school and aren't testable from a photographed answer sheet.

## Stack

- Google Apps Script (V8 runtime), bound to a Google Sheet.
- Plain HTML/CSS/vanilla JS web app (`HtmlService` + `google.script.run`), no build step.
- Anthropic API (`claude-sonnet-5`) via `UrlFetchApp` for vision-based grading
  and for drafting new questions (text-only) as the bank needs to grow.
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
  QuestionDrafter.gs    — AI question drafting (syllabus-topic-driven) + save-to-bank
  Index.html            — nav shell
  Generate.html         — "Generate Paper" page
  Grade.html            — "Grade a Paper" page (camera capture + review table)
  Progress.html         — "Progress" page (Chart.js). Named Progress.html, not
                          Dashboard.html, because Apps Script requires unique
                          file basenames across the whole project regardless
                          of extension, and Dashboard.gs already claims it.
  Draft.html            — "Draft Questions" page (review-before-save table)
  Styles.html           — shared mobile-first CSS, pulled in via include()
  seed/questions.json   — the 51 seeded Maths/English questions, parsed from the Term 1 papers
```

## Subjects and strands

- **Mathematics** — Mental Maths, Large Numbers, Addition/Subtraction & Integers, Time & Money, Shape & Space
- **English** — Reading Comprehension, Grammar & Spelling, Letter Writing, Descriptive Writing
- **Hindi** — Comprehension, Grammar, Creative Writing
- **Marathi** — Reading & Comprehension, Grammar, Writing

Strands, syllabus topics and default mark weights all come from the Grade 5
Term 1 Learning Expectations document and live in `Code.gs` (`strand_weights_*`
Config defaults) and `QuestionDrafter.gs` (`SYLLABUS_TOPICS`, used to keep
AI-drafted questions on-syllabus). Maths and English started with 51
questions parsed from real Term 1 papers; Hindi and Marathi start with an
empty bank — use **Draft Questions** to populate them before generating a
paper for either.

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
