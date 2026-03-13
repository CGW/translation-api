const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const parseRoute = require('./routes/parse');
const reassembleRoute = require('./routes/reassemble');
const downloadRoute = require('./routes/download');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Ensure temp storage directory exists ─────────────────────────────────────
const TMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet());

// CORS — restrict to your Base44 app domain in production
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
}));

// Rate limiting — prevents abuse (100 requests per 15 minutes per IP)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'too_many_requests', message: 'Slow down — try again in 15 minutes.' }
});
app.use(limiter);

// ── API key auth middleware ───────────────────────────────────────────────────
// Set API_KEY env var on Railway. Base44 sends this in X-API-Key header.
app.use((req, res, next) => {
  if (req.path === '/health') return next(); // health check is public

  const apiKey = process.env.API_KEY;
  if (!apiKey) return next(); // if no key set, skip auth (dev mode)

  const provided = req.headers['x-api-key'];
  if (!provided || provided !== apiKey) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid X-API-Key header.' });
  }
  next();
});

app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

app.use('/parse', parseRoute);
app.use('/reassemble', reassembleRoute);
app.use('/download', downloadRoute);

// ── Cleanup job — delete tmp files older than 24 hours ───────────────────────
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  fs.readdirSync(TMP_DIR).forEach(file => {
    const filePath = path.join(TMP_DIR, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.rmSync(filePath, { recursive: true, force: true });
    }
  });
}, 60 * 60 * 1000); // run every hour

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'server_error', message: err.message || 'Something went wrong.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Translation API running on port ${PORT}`);
});
