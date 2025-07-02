const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const verifyToken = require('../middleware/verifyToken');
const { v4: uuidv4 } = require('uuid');
const invite_token = uuidv4();


// Create a group

// GET /api/groups - List all public groups
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, invite_token, created_by, description FROM groups`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get groups error:', err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// GET /api/groups/:group_id/status
router.get('/:group_id/status', verifyToken, async (req, res) => {
  const group_id = req.params.group_id;
  const user_id = req.user.id;

  try {
    const isMember = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [group_id, user_id]
    );

    if (isMember.rows.length > 0) return res.json({ status: 'member' });

    const pending = await pool.query(
      'SELECT 1 FROM group_join_requests WHERE group_id = $1 AND user_id = $2 AND status = $3',
      [group_id, user_id, 'pending']
    );

    if (pending.rows.length > 0) return res.json({ status: 'pending' });

    return res.json({ status: 'not_joined' });
  } catch (err) {
    console.error('Check group status error:', err);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

router.get('/:group_id/members/count', verifyToken, async (req, res) => {
  const { group_id } = req.params;

  try {
    const result = await pool.query(
      'SELECT COUNT(*) FROM group_members WHERE group_id = $1',
      [group_id]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    console.error('Member count error:', err);
    res.status(500).json({ error: 'Failed to count members' });
  }
});


router.post('/create', verifyToken, async (req, res) => {
  const { name, description } = req.body;
  const creatorId = req.user.id;

  try {
    const group = await pool.query(
      `INSERT INTO groups (name, created_by, invite_token, description)
   VALUES ($1, $2, $3, $4)
   RETURNING id, name, invite_token`,
      [name, creatorId, invite_token, description]
    );

    const groupId = group.rows[0].id;

    // Add the creator as a member
    await pool.query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`,
      [groupId, creatorId]
    );

    res.status(201).json({ message: 'Group created', group_id: groupId });
  } catch (err) {
    console.error('Group creation error:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// GET /api/groups/owned/requests
router.get('/owned/requests', verifyToken, async (req, res) => {
  const admin_id = req.user.id;

  try {
    const requests = await pool.query(
      `SELECT r.id, r.user_id, r.status, r.group_id, u.name, u.profile_picture
       FROM group_join_requests r
       JOIN groups g ON r.group_id = g.id
       JOIN users u ON r.user_id = u.id
       WHERE g.created_by = $1 AND r.status = 'pending'`,
      [admin_id]
    );

    const formatted = requests.rows.map(r => ({
      id: r.id,
      user_id: r.user_id,
      name: r.name,
      profile_picture_url: r.profile_picture
        ? `http://localhost:5000/${r.profile_picture}`
        : null
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching owned group requests:', err);
    res.status(500).json({ error: 'Failed to fetch group requests' });
  }
});


// Join a group by ID
router.post('/join', verifyToken, async (req, res) => {
  const { group_id } = req.body;
  const user_id = req.user.id;

  try {
    const exists = await pool.query(
      `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [group_id, user_id]
    );

    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Already a member of the group' });
    }

    await pool.query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`,
      [group_id, user_id]
    );

    res.json({ message: 'Joined group successfully' });
  } catch (err) {
    console.error('Join group error:', err);
    res.status(500).json({ error: 'Failed to join group' });
  }
});

// List group members
router.get('/:group_id/members', verifyToken, async (req, res) => {
  const group_id = req.params.group_id;

  try {
    const members = await pool.query(
      `SELECT users.id, users.name, users.profile_picture
       FROM users
       JOIN group_members ON users.id = group_members.user_id
       WHERE group_members.group_id = $1`,
      [group_id]
    );

    const list = members.rows.map(u => ({
      ...u,
      profile_picture_url: u.profile_picture
        ? `http://localhost:5000/${u.profile_picture}`
        : null
    }));

    res.json(list);
  } catch (err) {
    console.error('Fetch group members error:', err);
    res.status(500).json({ error: 'Failed to load members' });
  }
});

// Get group chat history
router.get('/:group_id/messages', verifyToken, async (req, res) => {
  const group_id = req.params.group_id;

  try {
    const result = await pool.query(
      `SELECT * FROM messages WHERE group_id = $1 ORDER BY timestamp`,
      [group_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Group chat history error:', err);
    res.status(500).json({ error: 'Failed to fetch group messages' });
  }
});

// DELETE /api/groups/:group_id/members/:user_id (Admin only)
router.delete('/:group_id/members/:user_id', verifyToken, async (req, res) => {
  const { group_id, user_id } = req.params;
  const requesterId = req.user.id;

  // Check if requester is group creator
  const adminCheck = await pool.query(
    'SELECT * FROM groups WHERE id = $1 AND created_by = $2',
    [group_id, requesterId]
  );

  if (adminCheck.rows.length === 0) {
    return res.status(403).json({ error: 'Only the group creator can remove members' });
  }

  await pool.query(
    'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
    [group_id, user_id]
  );

  res.json({ message: 'Member removed successfully' });
});

// POST /api/groups/invite/:token
router.post('/invite/:token', verifyToken, async (req, res) => {
  const token = req.params.token;
  const user_id = req.user.id;

  try {
    const group = await pool.query(
      'SELECT id FROM groups WHERE invite_token = $1',
      [token]
    );

    if (group.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid invite token' });
    }

    const group_id = group.rows[0].id;

    await pool.query(
      `INSERT INTO group_members (group_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [group_id, user_id]
    );

    res.json({ message: 'Joined group', group_id });
  } catch (err) {
    console.error('Invite error:', err);
    res.status(500).json({ error: 'Failed to join group' });
  }
});

// POST /api/groups/:group_id/request-join
router.post('/:group_id/request-join', verifyToken, async (req, res) => {
  const group_id = req.params.group_id;
  const user_id = req.user.id;

  try {
    // Prevent duplicate request
    const exists = await pool.query(
      `SELECT * FROM group_join_requests WHERE group_id = $1 AND user_id = $2 AND status = 'pending'`,
      [group_id, user_id]
    );

    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Join request already sent' });
    }

    await pool.query(
      `INSERT INTO group_join_requests (group_id, user_id)
       VALUES ($1, $2)`,
      [group_id, user_id]
    );

    res.json({ message: 'Join request submitted' });
  } catch (err) {
    console.error('Join request error:', err);
    res.status(500).json({ error: 'Failed to send join request' });
  }
});

// GET /api/groups/:group_id/requests
router.get('/:group_id/requests', verifyToken, async (req, res) => {
  const group_id = req.params.group_id;
  const admin_id = req.user.id;

  try {
    const check = await pool.query(
      'SELECT * FROM groups WHERE id = $1 AND created_by = $2',
      [group_id, admin_id]
    );

    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'Only the group creator can view requests' });
    }

    const requests = await pool.query(
      `SELECT r.id, r.user_id, r.status, u.name, u.profile_picture
       FROM group_join_requests r
       JOIN users u ON r.user_id = u.id
       WHERE r.group_id = $1 AND r.status = 'pending'`,
      [group_id]
    );

    const data = requests.rows.map(r => ({
      ...r,
      profile_picture_url: r.profile_picture
        ? `http://localhost:5000/${r.profile_picture}`
        : null
    }));

    res.json(data);
  } catch (err) {
    console.error('Fetch join requests error:', err);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// POST /api/groups/requests/:request_id/respond
router.post('/requests/:request_id/respond', verifyToken, async (req, res) => {
  const { request_id } = req.params;
  const { action } = req.body; // 'accept' or 'reject'
  const admin_id = req.user.id;

  if (!['accept', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  try {
    // Get the request and group
    const result = await pool.query(
      `SELECT r.*, g.created_by FROM group_join_requests r
       JOIN groups g ON r.group_id = g.id
       WHERE r.id = $1`,
      [request_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const request = result.rows[0];

    if (request.created_by !== admin_id) {
      return res.status(403).json({ error: 'Only group creator can respond' });
    }

    // Update status
    await pool.query(
      `UPDATE group_join_requests SET status = $1 WHERE id = $2`,
      [action, request_id]
    );

    // If accepted, add to group_members
    if (action === 'accept') {
      await pool.query(
        `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [request.group_id, request.user_id]
      );
    }

    res.json({ message: `Request ${action}ed successfully` });
  } catch (err) {
    console.error('Respond error:', err);
    res.status(500).json({ error: 'Failed to respond to request' });
  }
});


// GET /api/groups/:group_id
router.get('/:group_id', verifyToken, async (req, res) => {
  const group_id = req.params.group_id;
  const user_id = req.user.id;

  try {
    const group = await pool.query(
      'SELECT id, name, created_by, invite_token, description FROM groups WHERE id = $1',
      [group_id]
    );

    if (group.rows.length === 0) return res.status(404).json({ error: 'Group not found' });

    const isAdmin = group.rows[0].created_by === user_id;

    res.json({ ...group.rows[0], isAdmin });
  } catch (err) {
    console.error('Fetch group metadata error:', err);
    res.status(500).json({ error: 'Failed to fetch group info' });
  }
});




module.exports = router;
