# Hamza EdTrack

A personal Google Apps Script tool for tracking Hamza's (Grade 5, IB curriculum)
test performance across Maths, English, Hindi and Marathi: generate papers
from a question bank, grade photographed answer sheets with the Gemini API's
vision support, keep growing the bank with AI-drafted questions, and track
progress by strand over time. Runs entirely on Google's free stack.

Unit of Inquiry and Art aren't covered — they're inquiry/craft-based rather
than question-and-answer written tests, so there's nothing to generate a
paper or grade a photo against. French is intentionally excluded per
Hamza's parent. Hindi and Marathi papers only cover their written strands
(comprehension, grammar, writing) — recitation and speaking are assessed
orally at school and aren't testable from a photographed answer sheet.

## Stack

- Google Apps Script (V8 runtime), bound to a Google Sheet.
- Plain HTML/CSS/vanilla JS web app (`HtmlService` + `google.script.run`), no build step.
- Gemini API via `UrlFetchApp` for vision-based grading and for drafting new
  questions (text-only) as the bank needs to grow. Chosen over Anthropic's
  API so the key comes from the same Google account already used for
  everything else here, with Google AI Studio's free tier. Which model is
  active is a **Settings** page choice (default `gemini-3.8-flash`), not a
  hardcoded constant — useful since a "high demand" 503 on one model can
  often be worked around by switching to another.
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
  AI.gs                 — shared Gemini API access (endpoint, auth, response parsing)
  Grading.gs            — vision grading via AI.gs + Results persistence
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
  Settings.html         — student name + Gemini model picker
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

1. **Set the Gemini API key** (never committed to the repo): get a free key from
   [Google AI Studio](https://aistudio.google.com/apikey) — sign in with the
   same Google account this Sheet/script belongs to, click **Create API key**,
   and copy it. Then in the Apps Script editor → ⚙️ **Project Settings** →
   **Script Properties** → **Add script property** → name `GEMINI_API_KEY`,
   value = the key you copied.

2. **Seed the question bank**: in the Apps Script editor, select the
   `seedQuestionBank` function and click Run once. Check **View → Logs** for
   the per-subject/strand count summary, and check the `QuestionBank` tab in
   the Sheet to confirm the rows landed.

3. **Register the real Term 1 Maths/English papers**: select `seedOriginalPapers`
   and click Run once. This adds `MATH-TERM1-ORIGINAL` and `ENG-TERM1-ORIGINAL`
   to the `Papers` tab (all seeded questions, in their original order, with
   real paper + answer-key Docs generated) so Hamza's actual already-completed
   Term 1 papers can be picked on the **Grade a Paper** page.

4. **Deploy the web app** (see below) and open the `/exec` URL it prints.

## Sharing

The web app is deployed with `executeAs: USER_DEPLOYING` and
`access: ANYONE_ANONYMOUS` — anyone with the `/exec` link can open it, but it
always reads/writes the one bound Sheet as the deploying Google account.
There's no login screen. This is the simplest option for a single-family,
single-student tool; if that's ever a concern, tighten `webapp.access` in
`appsscript.json` to `DOMAIN` or `MYSELF` and redeploy.

## Notes on grading

- Photos are base64-encoded in the browser, sent to `gradeSubmission()`, used
  for exactly one Gemini API call, and then discarded — they are never
  written to the Sheet or Drive.
- The AI's first pass is never final: the Grade page shows an editable marks
  column before anything is saved. Saving only flips `teacher_override` to
  `true` on rows whose mark was actually changed.
- **Past Submissions** on the Grade page lists every graded attempt and lets
  you re-open (and still correct) its breakdown later — it's the same
  editable table, just loaded from saved `Results` rows instead of a fresh
  grading call.
- To grade a sheet a student photographed and sent over WhatsApp: save their
  photo(s) to your camera roll, then on the file picker choose "Photo
  Library" instead of the camera. There's no automatic way to pull images
  out of WhatsApp — it has no public API for that without registering as a
  WhatsApp Business API app (Meta business verification, a persistent
  webhook receiver, phone number registration), which is out of scope for a
  personal Apps Script tool. This manual hand-off is the realistic path.

## Sharing a paper

Every row in **Previously Generated Papers** (Generate page) has a **Share**
link that opens `wa.me` with a pre-filled message containing the paper's Doc
link — pick the chat to send it to and it goes straight into WhatsApp. Only
the paper link is shared, never the answer key.

## Generating multiple papers at once

The Generate page has a "How many papers" field (1–10) for producing several
independent practice papers in one request — useful for extra practice
without repeating the same 60-mark test. Each one samples the bank
independently; because `times_used`/`last_used_date` update after every
paper, later papers in the same batch naturally favour questions the earlier
ones didn't use.

## On making this a PWA

A true installable PWA (a `manifest.json`, a service worker, offline
caching) isn't achievable on Apps Script: Google serves `HtmlService` pages
through a sandboxed iframe on a `googleusercontent.com` origin that it fully
controls, so there's no way to register a service worker or serve a
manifest from your own origin. The practical equivalent that *does* work:
bookmark the `/exec` URL and use your phone browser's "Add to Home Screen" —
it launches full-screen without browser chrome, which is most of what a PWA
would buy here anyway.
