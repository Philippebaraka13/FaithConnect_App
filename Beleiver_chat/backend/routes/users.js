const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const bcrypt = require('bcryptjs');
const upload = require('../uploads/upload');
const verifyToken = require('../middleware/verifyToken');
const requireAdmin = require('../middleware/requireAdmin');
const jwt = require('jsonwebtoken');


// GET all users
router.get('/', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, phone, email, age, gender, city, state, country, church_name, social_status,
             is_verified, is_blocked, profile_picture
      FROM users
    `);

    const users = result.rows.map(u => ({
      ...u,
      profile_picture_url: u.profile_picture ? `http://localhost:5000/${u.profile_picture}` : null
    }));

    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Database error' });
  }
});


router.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ time: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB connection failed' });
  }
});

// GET /api/users/me (Protected)
router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    delete user.password;
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

// POST /api/users/register
router.post('/register', upload.single('profile_picture'), async (req, res) => {
  const {
    name,
    phone,
    gender,
    age,
    city,
    state,
    country,
    church_name,
    social_status,
    password,
    email
  } = req.body;

  if (!name || !gender || !age || !city || !state || !country || !church_name || !social_status || !password || !email) {
    return res.status(400).json({ error: 'All fields are required including password' });
  }

  if (age < 18 || age > 35) {
    return res.status(400).json({ error: 'Age must be between 18 and 35' });
  }

  try {
    const existing = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Phone number already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const profilePicPath = req.file ? req.file.path : null;

    const result = await pool.query(
      `INSERT INTO users 
      (name, phone, gender, age, city, state, country, church_name, social_status, profile_picture, is_verified, password, email)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [name, phone, gender, age, city, state, country, church_name, social_status, profilePicPath, false, hashedPassword, email]
    );

    const user = result.rows[0];
    delete user.password;
    if (user.profile_picture) {
      user.profile_picture_url = `http://localhost:5000/${user.profile_picture}`;
    }


    res.status(201).json(user);

  } catch (err) {
    console.error('Error registering user:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/users/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.is_verified) {
      return res.status(403).json({ error: 'Your account has not been verified by the admin yet' });
    }
    if (user.is_blocked) {
      return res.status(403).json({ error: 'Your account has been blocked by the admin' });
    }


    // ✅ Generate JWT with is_admin
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        is_admin: user.is_admin // <- this is the new field
      },
      process.env.SECRET_KEY,
      { expiresIn: '1h' }
    );

    delete user.password;

    if (user.profile_picture) {
      user.profile_picture_url = `http://localhost:5000/${user.profile_picture}`;
    }

    res.json({ message: 'Login successful', user, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// GET /api/users/pending (Admin Only)
router.get('/pending', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, phone, age, gender, city, state, country, church_name, social_status, profile_picture FROM users WHERE is_verified = false'
    );
    const users = result.rows.map(u => ({
      ...u,
      profile_picture_url: u.profile_picture ? `http://localhost:5000/${u.profile_picture}` : null
    }));

    res.json(users);
  } catch (err) {
    console.error('Error fetching pending users:', err);
    res.status(500).json({ error: 'Failed to fetch pending users' });
  }
});

// GET /api/users/:id/groups
router.get('/:id/groups', verifyToken, async (req, res) => {
  const userId = req.params.id;

  const result = await pool.query(
    `SELECT g.id, g.name
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = $1`,
    [userId]
  );

  res.json(result.rows);
});

// GET /api/users/:id/public-profile
router.get('/:id/public-profile', verifyToken, async (req, res) => {
  const { id } = req.params;
  const currentUserId = req.user.id;

  if (id === currentUserId) {
    return res.status(400).json({ error: 'Cannot view your own profile here' });
  }

  try {
    const result = await pool.query(`
      SELECT id, name, gender, city, state, country, church_name, social_status, profile_picture
      FROM users
      WHERE id = $1 AND is_verified = true AND is_blocked = false
    `, [id]);

    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.profile_picture_url = user.profile_picture
      ? `http://localhost:5000/${user.profile_picture}`
      : null;

    res.json(user);
  } catch (err) {
    console.error('Public profile fetch error:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});


// PATCH /api/users/:id/verify (Admin Only)
router.patch('/:id/verify', verifyToken, requireAdmin, async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query(
      'UPDATE users SET is_verified = true WHERE id = $1 RETURNING *',
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    delete user.password;

    if (user.profile_picture) {
      user.profile_picture_url = `http://localhost:5000/${user.profile_picture}`;
    }

    res.json({ message: 'User verified successfully', user });
  } catch (err) {
    console.error('Error verifying user:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// PATCH /api/users/:id/block-toggle
router.patch('/:id/block-toggle', verifyToken, requireAdmin, async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query(`
      UPDATE users
      SET is_blocked = NOT is_blocked
      WHERE id = $1
      RETURNING id, name, is_blocked
    `, [userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: `User ${result.rows[0].is_blocked ? 'blocked' : 'unblocked'} successfully`,
      user: result.rows[0]
    });
  } catch (err) {
    console.error('Block toggle error:', err);
    res.status(500).json({ error: 'Failed to block/unblock user' });
  }
});


// GET /api/users/suggestions
router.get('/suggestions', verifyToken, async (req, res) => {
  const currentUserId = req.user.id;

  try {
    // Get current user's info
    const result = await pool.query(
      `SELECT gender, city, state, social_status FROM users WHERE id = $1 AND is_verified = true`,
      [currentUserId]
    );

    const currentUser = result.rows[0];
    if (!currentUser) return res.status(404).json({ error: 'User not found or not verified' });

    if (currentUser.social_status !== 'single') {
      return res.status(403).json({ error: 'Only single users receive suggestions' });
    }

    // Only opposite gender
    const targetGender = currentUser.gender === 'male' ? 'female' : 'male';

    // 1. Nearby matches
    const nearMatches = await pool.query(
      `SELECT id, name, gender, age, city, state, church_name, profile_picture
         FROM users
         WHERE id != $1
           AND is_verified = true
           AND social_status = 'single'
           AND gender = $2
           AND city = $3
           AND state = $4`,
      [currentUserId, targetGender, currentUser.city, currentUser.state]
    );

    // 2. Other matches
    const otherMatches = await pool.query(
      `SELECT id, name, gender, age, city, state, church_name, profile_picture
         FROM users
         WHERE id != $1
           AND is_verified = true
           AND social_status = 'single'
           AND gender = $2
           AND NOT (city = $3 AND state = $4)`,
      [currentUserId, targetGender, currentUser.city, currentUser.state]
    );

    // Merge
    const combined = [...nearMatches.rows, ...otherMatches.rows].map(u => ({
      ...u,
      profile_picture_url: u.profile_picture
        ? `http://localhost:5000/${u.profile_picture}`
        : null
    }));

    res.json(combined);

  } catch (err) {
    console.error('Suggestion error:', err);
    res.status(500).json({ error: 'Failed to load suggestions' });
  }
});

// GET /api/users/find-people
router.get('/find-people', verifyToken, async (req, res) => {
  const currentUserId = req.user.id;

  try {
    const userResult = await pool.query(
      'SELECT gender, city, state, social_status, is_admin FROM users WHERE id = $1',
      [currentUserId]
    );

    const currentUser = userResult.rows[0];
    if (!currentUser) return res.status(404).json({ error: 'User not found' });

    const oppositeGender = currentUser.gender === 'male' ? 'female' : 'male';

    // Admins can see ALL opposite-gender verified singles (even if already connected)
    if (currentUser.is_admin) {
      const result = await pool.query(
        `SELECT u.id, u.name, u.gender, u.city, u.state, u.church_name, u.profile_picture
         FROM users u
         WHERE u.id != $1
           AND u.gender = $2
           AND u.social_status = 'single'
           AND u.is_verified = true
           AND u.is_blocked = false`,
        [currentUserId, oppositeGender]
      );

      const users = result.rows.map(u => ({
        ...u,
        profile_picture_url: u.profile_picture
          ? `http://localhost:5000/${u.profile_picture}`
          : null
      }));

      return res.json(users);
    }

    // Regular users get filtered suggestions excluding already connected users
    const result = await pool.query(
      `SELECT u.id, u.name, u.gender, u.city, u.state, u.church_name, u.profile_picture
       FROM users u
       WHERE u.id != $1
         AND u.gender = $2
         AND u.is_verified = true
         AND u.is_blocked = false
         AND u.social_status = 'single'
         AND u.id NOT IN (
           SELECT CASE
             WHEN c.sender_id = $1 THEN c.receiver_id
             WHEN c.receiver_id = $1 THEN c.sender_id
           END
           FROM connections c
           WHERE c.sender_id = $1 OR c.receiver_id = $1
         )`,
      [currentUserId, oppositeGender]
    );

    const users = result.rows.map(u => ({
      ...u,
      profile_picture_url: u.profile_picture
        ? `http://localhost:5000/${u.profile_picture}`
        : null
    }));

    res.json(users);
  } catch (err) {
    console.error('Find people error:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// POST /api/users/upload-picture (Protected route to upload and link profile picture)
router.post('/upload-picture', verifyToken, upload.single('profile_picture'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const profilePath = `uploads/${req.file.filename}`;
  const userId = req.user.id;

  try {
    await pool.query(
      'UPDATE users SET profile_picture = $1 WHERE id = $2',
      [profilePath, userId]
    );

    const profileUrl = `http://localhost:5000/${profilePath}`;
    res.json({ success: true, profile_picture_url: profileUrl });
  } catch (err) {
    console.error('Profile upload error:', err);
    res.status(500).json({ error: 'Failed to save profile picture' });
  }
});




module.exports = router;
