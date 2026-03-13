const express = require('express');
const path = require('path');
const fs = require('fs');
const { rebuildPptx } = require('../builders/pptx');

const router = express.Router();

/**
 * POST /reassemble
 * 
 * Accepts: application/json with:
 *   - job_id: string (from /parse response)
 *   - translated_sections: array (same structure as sections from /parse, text replaced)
 *   - target_language: string (e.g. "Spanish") — used for output filename
 * 
 * Returns: { download_url, expires_at, filename }
 */
router.post('/', async (req, res) => {
  const { job_id, translated_sections, target_language } = req.body;

  if (!job_id || !translated_sections) {
    return res.status(400).json({
      error: 'missing_fields',
      message: 'job_id and translated_sections are required.'
    });
  }

  // Load the job metadata saved by /parse
  const jobDir = path.join(__dirname, '..', 'tmp', job_id);
  const metaPath = path.join(jobDir, 'meta.json');

  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({
      error: 'job_not_found',
      message: 'Job ID not found. It may have expired (24h TTL).'
    });
  }

  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return res.status(500).json({ error: 'meta_corrupt', message: 'Could not read job metadata.' });
  }

  try {
    const originalPath = path.join(jobDir, `original.${meta.format}`);
    const originalBuffer = fs.readFileSync(originalPath);

    let outputBuffer;

    if (meta.format === 'pptx') {
      outputBuffer = await rebuildPptx(
        originalBuffer,
        meta.sections,         // original text (for finding and replacing)
        translated_sections    // translated text (replacements)
      );
    } else {
      return res.status(400).json({
        error: 'format_not_supported',
        message: `Reassembly for .${meta.format} not yet implemented.`
      });
    }

    // Build output filename: "original_name_Spanish.pptx"
    const baseName = path.basename(meta.originalFilename, `.${meta.format}`);
    const langSuffix = target_language ? `_${target_language.replace(/\s+/g, '_')}` : '_translated';
    const outputFilename = `${baseName}${langSuffix}.${meta.format}`;
    const outputPath = path.join(jobDir, outputFilename);

    fs.writeFileSync(outputPath, outputBuffer);

    // Build the download URL — points to GET /download/:job_id/:filename
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const downloadUrl = `${baseUrl}/download/${job_id}/${encodeURIComponent(outputFilename)}`;

    // Calculate expiry (24h from now)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    res.json({
      download_url: downloadUrl,
      expires_at: expiresAt,
      filename: outputFilename,
      slide_count: meta.sections.length,
    });

  } catch (err) {
    console.error('Reassemble error:', err);
    res.status(500).json({ error: 'reassembly_failed', message: err.message });
  }
});

module.exports = router;
