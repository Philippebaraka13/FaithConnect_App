const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const verifyToken = require('../middleware/verifyToken');

// Send connection request
router.post('/request', verifyToken, async (req, res) => {
  const senderId = req.user.id;
  const { receiverId } = req.body;

  try {
    const existing = await pool.query(
      'SELECT * FROM connections WHERE sender_id = $1 AND receiver_id = $2',
      [senderId, receiverId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Connection request already exists' });
    }

    await pool.query(
      'INSERT INTO connections (sender_id, receiver_id) VALUES ($1, $2)',
      [senderId, receiverId]
    );

    res.json({ message: 'Request sent' });
  } catch (err) {
    console.error('Connection request error:', err);
    res.status(500).json({ error: 'Could not send connection request' });
  }
});

// View pending requests
router.get('/pending', verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT c.id, u.name, u.profile_picture, u.id as user_id
       FROM connections c
       JOIN users u ON u.id = c.sender_id
       WHERE c.receiver_id = $1 AND c.status = 'pending'`,
      [userId]
    );

    const requests = result.rows.map(r => ({
      ...r,
      profile_picture_url: r.profile_picture
        ? `http://localhost:5000/${r.profile_picture}`
        : null
    }));

    res.json(requests);
  } catch (err) {
    console.error('Pending request fetch error:', err);
    res.status(500).json({ error: 'Could not fetch pending requests' });
  }
});

// GET /api/connections/accepted
router.get('/accepted', verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.profile_picture, u.church_name, u.city, u.state
       FROM connections c
       JOIN users u ON (u.id = c.sender_id OR u.id = c.receiver_id)
       WHERE c.status = 'accepted'
         AND (c.sender_id = $1 OR c.receiver_id = $1)
         AND u.id != $1`,
      [userId]
    );

    const connections = result.rows.map(u => ({
      ...u,
      profile_picture_url: u.profile_picture
        ? `http://localhost:5000/${u.profile_picture}`
        : null
    }));

    res.json(connections);
  } catch (err) {
    console.error('Accepted connection error:', err);
    res.status(500).json({ error: 'Failed to load connections' });
  }
});


// Respond to request
router.post('/respond', verifyToken, async (req, res) => {
  const receiverId = req.user.id;
  const { requestId, action } = req.body;

  if (!['accept', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const status = action === 'accept' ? 'accepted' : 'rejected';

  try {
    await pool.query(
      'UPDATE connections SET status = $1 WHERE id = $2 AND receiver_id = $3',
      [status, requestId, receiverId]
    );

    res.json({ message: `Connection ${status}` });
  } catch (err) {
    console.error('Connection respond error:', err);
    res.status(500).json({ error: 'Could not update request' });
  }
});

module.exports = router;
