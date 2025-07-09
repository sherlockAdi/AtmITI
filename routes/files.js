const express = require('express');
const router = express.Router();
const { getFileStream } = require('../utils/b2');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const DOC_DIR = path.join(__dirname, '../doc');

// Ensure doc directory exists
if (!fs.existsSync(DOC_DIR)) {
  fs.mkdirSync(DOC_DIR);
}

router.get('/:fileName', async (req, res) => {
  const { fileName } = req.params;
  const localFilePath = path.join(DOC_DIR, fileName);
  const mimeType = mime.lookup(fileName) || 'application/octet-stream';

  console.log(`[FILES ROUTE] Requested file: ${fileName}`);
  console.log(`[FILES ROUTE] Local file path: ${localFilePath}`);

  try {
    if (fs.existsSync(localFilePath)) {
      console.log(`[FILES ROUTE] Serving from local cache: ${localFilePath}`);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      return fs.createReadStream(localFilePath).pipe(res);
    }

    // Download from B2 and save locally
    console.log(`[FILES ROUTE] Downloading from B2: ${fileName}`);
    const fileStream = await getFileStream(fileName);
    const writeStream = fs.createWriteStream(localFilePath);
    fileStream.pipe(writeStream);
    fileStream.on('error', (err) => {
      console.error(`[FILES ROUTE] Error streaming from B2:`, err);
      res.status(500).send('<h1>Error streaming file</h1>');
    });
    writeStream.on('finish', () => {
      console.log(`[FILES ROUTE] Downloaded and saved to local cache: ${localFilePath}`);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      fs.createReadStream(localFilePath).pipe(res);
    });
    writeStream.on('error', (err) => {
      console.error(`[FILES ROUTE] Error saving file:`, err);
      res.status(500).send('<h1>Error saving file</h1>');
    });
  } catch (err) {
    console.error(`[FILES ROUTE] General error:`, err);
    res.status(404).send('<h1>File not found</h1>');
  }
});

router.get('/base64/:fileName', async (req, res) => {
  const { fileName } = req.params;
  const localFilePath = path.join(DOC_DIR, fileName);
  try {
    if (!fs.existsSync(localFilePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const fileBuffer = fs.readFileSync(localFilePath);
    const mimeType = mime.lookup(fileName) || 'application/pdf';
    const base64 = fileBuffer.toString('base64');
    res.json({
      base64: `data:${mimeType};base64,${base64}`,
      mimeType,
      fileName,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

module.exports = router; 