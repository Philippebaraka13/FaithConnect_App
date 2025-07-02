const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const upload = require('../uploads/upload');
const path = require('path');

const verifyToken = require('../middleware/verifyToken');

// POST /api/chat/send
router.post('/send', verifyToken, async (req, res) => {
  const { receiver_id, group_id, message_text } = req.body;
  const sender_id = req.user.id;

  try {
    await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, group_id, message_text, is_read)
   VALUES ($1, $2, $3, $4, $5)`,
      [sender_id, receiver_id, group_id, message_text, false]
    );


    res.status(201).json({ message: 'Message sent' });
  } catch (err) {
    console.error('Send error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// POST /api/chat/upload-image
router.post('/upload-image', verifyToken, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }

  const imageUrl = `http://localhost:5000/uploads/${req.file.filename}`;
  res.status(200).json({ imageUrl });
});

// GET /api/chat/unread-senders
router.get('/unread-senders', verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT DISTINCT sender_id FROM messages
       WHERE receiver_id = $1 AND is_read = false`,
      [userId]
    );

    const senderIds = result.rows.map(row => row.sender_id);
    res.json({ senderIds });
  } catch (err) {
    console.error('Unread senders error:', err);
    res.status(500).json({ error: 'Failed to fetch unread senders' });
  }
});


// GET /api/chat/unread-count
router.get('/unread-count', verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM messages
       WHERE receiver_id = $1 AND is_read = false`,
      [userId]
    );

    res.json({ unreadCount: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error('Unread count error:', err);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

router.post('/mark-read/:otherUserId', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const otherUserId = req.params.otherUserId;

  try {
    await pool.query(
      `UPDATE messages
       SET is_read = true
       WHERE sender_id = $1 AND receiver_id = $2`,
      [otherUserId, userId]
    );

    res.json({ message: 'Messages marked as read' });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});


// GET /api/chat/history/:otherUserId
router.get('/history/:otherUserId', verifyToken, async (req, res) => {
  const user1 = req.user.id;
  const user2 = req.params.otherUserId;

  try {
    const result = await pool.query(
      `SELECT * FROM messages
       WHERE ((sender_id = $1 AND receiver_id = $2)
           OR (sender_id = $2 AND receiver_id = $1))
         AND group_id IS NULL
       ORDER BY timestamp`,
      [user1, user2]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

module.exports = router;
