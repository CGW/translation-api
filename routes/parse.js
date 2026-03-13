const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parsePptx } = require('../parsers/pptx');

const router = express.Router();

// Store uploaded files in /tmp/<job_id>/ folder
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const jobId = require('crypto').randomUUID();
    req.jobId = jobId; // attach to request for use in route handler

    const jobDir = path.join(__dirname, '..', 'tmp', jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    cb(null, jobDir);
  },
  filename: (req, file, cb) => {
    // Preserve original filename for reassembly
    cb(null, 'original' + path.extname(file.originalname).toLowerCase());
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.pptx', '.pdf', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('unsupported_format'));
    }
    cb(null, true);
  }
});

/**
 * POST /parse
 * 
 * Accepts: multipart/form-data with fields:
 *   - file: the document (required)
 *   - format: 'pptx' | 'pdf' | 'docx' (optional, detected from extension if omitted)
 * 
 * Returns: JSON with job_id and structured sections
 */
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'no_file', message: 'No file uploaded.' });
  }

  const jobId = req.jobId;
  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    const buffer = fs.readFileSync(filePath);
    let result;

    if (ext === '.pptx') {
      result = await parsePptx(buffer);
    } else if (ext === '.docx') {
      // DOCX support — v1 stub, returns a single section
      // TODO: implement parsers/docx.js following the same pattern
      return res.status(400).json({
        error: 'format_coming_soon',
        message: 'DOCX support is in progress. Only PPTX is supported in v1.'
      });
    } else if (ext === '.pdf') {
      return res.status(400).json({
        error: 'format_coming_soon',
        message: 'PDF support is in progress. Only PPTX is supported in v1.'
      });
    }

    // Save metadata alongside the original file so /reassemble can find it
    const meta = {
      jobId,
      format: ext.slice(1),
      originalFilename: req.file.originalname,
      sections: result.sections,
      createdAt: new Date().toISOString(),
    };
    const metaPath = path.join(__dirname, '..', 'tmp', jobId, 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    // Return the structured extraction to Base44
    // Base44 will pass sections.blocks[].text to Claude for translation
    res.json({
      job_id: jobId,
      format: ext.slice(1),
      slide_count: result.slideCount,
      sections: result.sections,
      // Hint for the Base44 Claude prompt: approximate token count
      estimated_tokens: JSON.stringify(result.sections).length / 4,
    });

  } catch (err) {
    console.error('Parse error:', err);

    // Clean up failed job folder
    const jobDir = path.join(__dirname, '..', 'tmp', jobId);
    fs.rmSync(jobDir, { recursive: true, force: true });

    if (err.message === 'unsupported_format') {
      return res.status(400).json({ error: 'unsupported_format', message: 'File type not supported.' });
    }
    res.status(500).json({ error: 'parse_failed', message: err.message });
  }
});

module.exports = router;
