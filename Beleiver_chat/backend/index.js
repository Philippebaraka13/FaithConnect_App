// Load environment variables
require('dotenv').config();

// Import dependencies
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const chatRoutes = require('./routes/chat');
const groupRoutes = require('./routes/groups');
const userRoutes = require('./routes/users');
const connectionRoutes = require('./routes/connections');
const uploadRoute = require('./routes/upload');
const pool = require('./models/db');
const chatUpload = require('./routes/chatUpload'); 




// Initialize app
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/upload', uploadRoute);

// Routes
app.use('/api/users', userRoutes); 
app.use('/api/chat', chatRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/connections', connectionRoutes);
//app.use('/api/chat', chatUpload);


// Socket.IO (chat, etc.)
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
  
    // --- One-on-One Chat ---
    socket.on('join_room', (roomId) => {
      socket.join(roomId);
      console.log(`Socket ${socket.id} joined private room ${roomId}`);
    });
  
    socket.on('send_message', async (data) => {
      const { sender_id, receiver_id, message_text } = data;
      const room = [sender_id, receiver_id].sort().join('_');
  
      await pool.query(
        `INSERT INTO messages (sender_id, receiver_id, message_text)
         VALUES ($1, $2, $3)`,
        [sender_id, receiver_id, message_text]
      );
  
      io.to(room).emit('receive_message', {
        sender_id,
        receiver_id,
        message_text,
        timestamp: new Date()
      });
    });
  
    // --- Group Chat ---
    socket.on('join_group', (groupId) => {
      socket.join(groupId);
      console.log(`Socket ${socket.id} joined group ${groupId}`);
    });
  
    socket.on('group_message', async (data) => {
      const { sender_id, group_id, message_text } = data;
  
      await pool.query(
        `INSERT INTO messages (sender_id, group_id, message_text)
         VALUES ($1, $2, $3)`,
        [sender_id, group_id, message_text]
      );
  
      io.to(group_id).emit('receive_group_message', {
        sender_id,
        group_id,
        message_text,
        timestamp: new Date()
      });
    });
  
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });
  
  

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

