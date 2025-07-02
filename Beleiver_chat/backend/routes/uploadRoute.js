// routes/uploadRoute.js
const express = require('express');
const router = express.Router();
const upload = require('../uploads/upload'); // Your multer config

router.post('/image', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const imageUrl = `http://localhost:5000/uploads/${req.file.filename}`;
  res.json({ imageUrl });
});

module.exports = router;
