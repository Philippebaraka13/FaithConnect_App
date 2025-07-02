const express = require('express');
const router = express.Router();
const upload = require('../uploads/upload'); 

router.post('/', upload.single('profile_picture'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ success: true, fileUrl });
});

module.exports = router;
