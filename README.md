# Translation API — Deployment & Base44 Integration Guide

## What this does

A lightweight REST backend that handles the parts of the translation pipeline
that can't run in a browser:

1. **POST /parse** — Unzips the PPTX, extracts text per slide into structured JSON
2. **POST /reassemble** — Takes translated JSON, replaces text in the original XML, returns a download URL
3. **GET /download/:job_id/:filename** — Serves the rebuilt file

Base44 calls /parse, sends the extracted text to Claude for translation,
then calls /reassemble with the result.

---

## Deploy to Railway (5 minutes)

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/translation-api.git
git push -u origin main
```

### Step 2 — Create Railway project

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. Select your `translation-api` repo
3. Railway auto-detects Node.js and runs `npm start`

### Step 3 — Set environment variables

In Railway → your project → Variables tab, add:

| Variable | Value |
|----------|-------|
| `API_KEY` | Run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste the result |
| `BASE_URL` | Railway will show your public URL after first deploy, e.g. `https://translation-api-production.up.railway.app` |
| `ALLOWED_ORIGIN` | Your Base44 app URL, e.g. `https://myapp.base44.app` |

### Step 4 — Verify

Visit `https://your-app.up.railway.app/health` — you should see:
```json
{ "status": "ok", "version": "1.0.0" }
```

### Cost

Railway Hobby plan is $5/month. At low volume (< 500 jobs/month) you'll
stay well within the included usage credits.

---

## Base44 Integration

Base44 apps can call external APIs using the built-in **HTTP Request** action
or via custom JavaScript in a code block. The fetch approach below works in
both Base44's action system and custom components.

### The 3-call flow in Base44

```javascript
// ─────────────────────────────────────────────────────────────────
// Step 1: Upload file to /parse — returns structured JSON
// ─────────────────────────────────────────────────────────────────

async function parseDocument(file) {
  const formData = new FormData();
  formData.append('file', file); // file is a File object from an upload input

  const response = await fetch('https://your-app.up.railway.app/parse', {
    method: 'POST',
    headers: {
      'X-API-Key': 'YOUR_API_KEY_HERE', // store this in Base44 secrets/env vars
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.message || 'Parse failed');
  }

  return response.json();
  // Returns: { job_id, format, slide_count, sections: [...] }
}


// ─────────────────────────────────────────────────────────────────
// Step 2: Send sections to Claude for translation
// (This is the Claude API call — stays in Base44)
// ─────────────────────────────────────────────────────────────────

async function translateSections(sections, targetLanguage) {
  // Only send blocks that aren't flagged as keep
  const textToTranslate = sections.map(section => ({
    id: section.id,
    blocks: section.blocks.filter(b => !b.keep)
  }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      // Note: In Base44, use your connected Anthropic integration — 
      // the API key is handled automatically by the connector.
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are a professional document translator. 
Translate the provided JSON content to ${targetLanguage}.
Rules:
- Preserve ALL JSON keys exactly as-is
- Do not translate TEKS codes (e.g. "TEKS 2.9.A")  
- Do not translate proper names like "Paul Bunyan"
- Preserve any text in [BRACKETS] unchanged
- Return ONLY valid JSON — no markdown, no explanation`,
      messages: [{
        role: 'user',
        content: `Translate this document content to ${targetLanguage}:\n${JSON.stringify(textToTranslate, null, 2)}`
      }]
    })
  });

  const data = await response.json();
  const translatedText = data.content[0].text;

  // Parse Claude's JSON response
  const translatedBlocks = JSON.parse(translatedText);

  // Merge translated blocks back into full sections structure
  // (keep blocks with keep:true unchanged)
  return sections.map(section => {
    const translatedSection = translatedBlocks.find(s => s.id === section.id);
    if (!translatedSection) return section;

    let translatedIdx = 0;
    const mergedBlocks = section.blocks.map(block => {
      if (block.keep) return block; // unchanged
      const translated = translatedSection.blocks[translatedIdx++];
      return translated || block;
    });

    return { ...section, blocks: mergedBlocks };
  });
}


// ─────────────────────────────────────────────────────────────────
// Step 3: Send translated sections to /reassemble
// ─────────────────────────────────────────────────────────────────

async function reassembleDocument(jobId, translatedSections, targetLanguage) {
  const response = await fetch('https://your-app.up.railway.app/reassemble', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'YOUR_API_KEY_HERE',
    },
    body: JSON.stringify({
      job_id: jobId,
      translated_sections: translatedSections,
      target_language: targetLanguage,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.message || 'Reassembly failed');
  }

  return response.json();
  // Returns: { download_url, expires_at, filename }
}


// ─────────────────────────────────────────────────────────────────
// Full pipeline — wire this to your Base44 "Translate" button
// ─────────────────────────────────────────────────────────────────

async function translateDocument(file, targetLanguage) {
  try {
    // Step 1
    updateStatus('Parsing document...');
    const parsed = await parseDocument(file);

    // Step 2
    updateStatus(`Translating ${parsed.slide_count} slides...`);
    const translatedSections = await translateSections(parsed.sections, targetLanguage);

    // Step 3
    updateStatus('Rebuilding document...');
    const result = await reassembleDocument(parsed.job_id, translatedSections, targetLanguage);

    updateStatus('Done!');
    return result.download_url; // show this as a download button in Base44

  } catch (err) {
    updateStatus('Error: ' + err.message);
    throw err;
  }
}

// Stub — replace with your Base44 state update mechanism
function updateStatus(msg) {
  console.log(msg);
}
```

### Storing the API key in Base44

Never hardcode `YOUR_API_KEY_HERE` in Base44 app code. Instead:

1. In Base44: Go to your app settings → Environment Variables (or Secrets)
2. Add `TRANSLATION_API_KEY` with the value from your Railway `API_KEY` variable
3. Reference it in your Base44 code as `process.env.TRANSLATION_API_KEY` 
   or via Base44's secrets API (check their docs for the exact syntax)

---

## File Structure

```
translation-api/
├── server.js              # Express app, auth middleware, cleanup job
├── routes/
│   ├── parse.js           # POST /parse — file upload + text extraction
│   ├── reassemble.js      # POST /reassemble — rebuild translated file
│   └── download.js        # GET /download/:job_id/:filename
├── parsers/
│   └── pptx.js            # Unzips PPTX, extracts text blocks per slide
├── builders/
│   └── pptx.js            # Replaces text in original XML, rezips
├── tmp/                   # Created at runtime — auto-cleaned after 24h
├── railway.json           # Railway deploy config
├── .env.example           # Copy to .env for local dev
└── package.json
```

## Adding DOCX support (next step)

Follow the same pattern as PPTX:
1. Create `parsers/docx.js` using the `mammoth` npm package for text extraction
2. Create `builders/docx.js` using the `docx` npm package for reassembly
3. Add the format check in `routes/parse.js` and `routes/reassemble.js`

DOCX is simpler than PPTX — no slide structure, just paragraphs and tables.
