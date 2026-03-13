const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

/**
 * GET /download/:job_id/:filename
 * Serves the rebuilt translated file for download.
 */
router.get('/:job_id/:filename', (req, res) => {
  const { job_id, filename } = req.params;

  // Sanitize: prevent path traversal attacks
  const safeFilename = path.basename(decodeURIComponent(filename));
  const filePath = path.join(__dirname, '..', 'tmp', job_id, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: 'file_not_found',
      message: 'File not found or has expired.'
    });
  }

  // Set content-disposition so browser triggers a download
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.sendFile(filePath);
});

module.exports = router;
