// --- New file: routes/chatUpload.js ---
const express = require('express');
const router = express.Router();
const upload = require('../uploads/upload');
const verifyToken = require('../middleware/verifyToken');
const pool = require('../models/db');

// POST /api/chat/upload-image
router.post('/upload-image', verifyToken, upload.single('image'), async (req, res) => {
  const sender_id = req.user.id;
  const { receiver_id, group_id } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }

  try {
    const image_path = req.file.path;

    if (group_id) {
      await pool.query(
        `INSERT INTO messages (sender_id, group_id, image_path)
         VALUES ($1, $2, $3)`,
        [sender_id, group_id, image_path]
      );
    } else if (receiver_id) {
      await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, image_path)
         VALUES ($1, $2, $3)`,
        [sender_id, receiver_id, image_path]
      );
    } else {
      return res.status(400).json({ error: 'receiver_id or group_id required' });
    }

    res.json({ success: true, image_url: `http://localhost:5000/${image_path}` });
  } catch (err) {
    console.error('Upload image error:', err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

module.exports = router;
