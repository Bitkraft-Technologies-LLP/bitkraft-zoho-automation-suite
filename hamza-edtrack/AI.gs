/**
 * AI.gs — shared Gemini API access for Grading.gs (vision grading) and
 * QuestionDrafter.gs (text question drafting). Both just build a `parts`
 * array and call callGemini_(); this file owns the endpoint, auth and
 * response parsing so there's one place to update if either changes.
 *
 * The active model is a Config value (set from the Settings page), read
 * fresh on every call via getGeminiModel_() — never hardcode a call to a
 * specific model id here. AVAILABLE_GEMINI_MODELS below feeds the Settings
 * dropdown; models confirmed current on 2026-09-06 (Gemini API docs /
 * release notes) — check https://ai.google.dev/gemini-api/docs/models and
 * update this list if a model retires or a newer one ships.
 */

var GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
var AVAILABLE_GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'];

/** Reads the active model from Config (Settings page), falling back to the default. */
function getGeminiModel_() {
  return getConfigValue_('gemini_model', GEMINI_DEFAULT_MODEL);
}

function getGeminiApiUrl_(model) {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
}

function getGeminiApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    throw new Error('GEMINI_API_KEY is not set. In the Apps Script editor: Project Settings → Script ' +
      'Properties → Add property, name it GEMINI_API_KEY, and paste a key from https://aistudio.google.com/apikey.');
  }
  return key;
}

/**
 * systemInstruction: plain string. parts: array of Gemini "part" objects
 * (e.g. {text: "..."} and/or {inlineData: {mimeType, data}} for images).
 * Returns the raw text of the model's response (JSON-mode is requested, but
 * callers should still parse defensively via extractJsonArray_).
 */
function callGemini_(systemInstruction, parts) {
  var apiKey = getGeminiApiKey_();
  var payload = {
    contents: [{ role: 'user', parts: parts }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { responseMimeType: 'application/json', temperature: 0.4 }
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // Gemini occasionally returns 429/500/503/504 under transient load — retry
  // a few times with backoff before surfacing an error, since a photo
  // grading request is expensive for the user to have to manually resubmit.
  var retryableStatuses = [429, 500, 503, 504];
  var delays = [3000, 8000, 15000, 30000];
  var apiUrl = getGeminiApiUrl_(getGeminiModel_());
  var response, status, lastErrorText;

  for (var attempt = 0; attempt <= delays.length; attempt++) {
    response = UrlFetchApp.fetch(apiUrl, options);
    status = response.getResponseCode();
    if (status === 200) break;
    lastErrorText = response.getContentText().substring(0, 500);
    if (retryableStatuses.indexOf(status) === -1 || attempt === delays.length) break;
    Utilities.sleep(delays[attempt]);
  }

  if (status !== 200) {
    throw new Error('Gemini API error (' + status + ', model ' + getGeminiModel_() + '): ' + lastErrorText);
  }

  var body = JSON.parse(response.getContentText());
  var candidate = (body.candidates || [])[0];
  if (!candidate || !candidate.content) {
    throw new Error('Gemini API returned no content: ' + response.getContentText().substring(0, 300));
  }
  return (candidate.content.parts || []).map(function (p) { return p.text || ''; }).join('');
}

/** Strips code fences / stray prose defensively before parsing the model's JSON array response. */
function extractJsonArray_(text) {
  var cleaned = String(text).trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    var start = cleaned.indexOf('[');
    var end = cleaned.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.substring(start, end + 1));
      } catch (e2) {
        // fall through to error below
      }
    }
    throw new Error('Could not parse AI response as JSON: ' + cleaned.substring(0, 300));
  }
}
