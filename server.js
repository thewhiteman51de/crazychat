const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const ChatDatabase = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Initialize database
const db = new ChatDatabase();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Store online users
const onlineUsers = new Map(); // socketId -> userId
const userSockets = new Map(); // userId -> socketId

// ===== API Routes =====

// Register
app.post('/api/register', (req, res) => {
    try {
        const { username, password, email } = req.body;

        if (!username || !password || !email) {
            return res.status(400).json({ error: 'Username, password and email required' });
        }

        if (username.length < 3) {
            return res.status(400).json({ error: 'Username must be at least 3 characters' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Simple email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email address' });
        }

        const user = db.createUser(username, password, email);
        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                avatar: user.avatar
            },
            token
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Login
app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const user = db.verifyPassword(username, password);

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);

        res.json({
            success: true,
            user,
            token
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all users
app.get('/api/users', (req, res) => {
    try {
        const users = db.getAllUsers();
        res.json({ users });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get chat list
app.get('/api/chats/:userId', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const chats = db.getChatList(userId);
        res.json({ chats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get messages between users
app.get('/api/messages/:userId/:otherUserId', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const otherUserId = parseInt(req.params.otherUserId);
        const messages = db.getMessagesBetweenUsers(userId, otherUserId);
        res.json({ messages });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Contact management
app.get('/api/contacts/:userId', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const contacts = db.getContacts(userId);
        res.json({ contacts });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/contacts', (req, res) => {
    try {
        const { userId, contactEmail, contactName } = req.body;

        if (!userId || !contactEmail) {
            return res.status(400).json({ error: 'User ID and contact email required' });
        }

        const contact = db.addContact(userId, contactEmail, contactName);
        res.json({ success: true, contact });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/contacts/:userId/:contactId', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const contactId = parseInt(req.params.contactId);
        db.deleteContact(userId, contactId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Message management
app.put('/api/messages/:messageId', (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId);
        const { message, userId } = req.body;

        if (!message || !userId) {
            return res.status(400).json({ error: 'Message and userId required' });
        }

        const updatedMessage = db.editMessage(messageId, message, userId);
        res.json({ success: true, message: updatedMessage });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/messages/:messageId', (req, res) => {
    try {
        const messageId = parseInt(req.params.messageId);
        const { userId, deleteForEveryone } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId required' });
        }

        const result = db.deleteMessage(messageId, userId, deleteForEveryone);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Blocking
app.post('/api/contacts/block', (req, res) => {
    try {
        const { userId, blockedUserId } = req.body;

        if (!userId || !blockedUserId) {
            return res.status(400).json({ error: 'userId and blockedUserId required' });
        }

        const block = db.blockContact(userId, blockedUserId);
        res.json({ success: true, block });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.delete('/api/contacts/block/:userId/:blockedId', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const blockedId = parseInt(req.params.blockedId);
        db.unblockContact(userId, blockedId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/contacts/blocked/:userId', (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const blocked = db.getBlockedContacts(userId);
        res.json({ blocked });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== WebSocket Events =====

io.on('connection', (socket) => {
    console.log('🔌 New connection:', socket.id);

    // User authentication
    socket.on('authenticate', (data) => {
        try {
            const { token } = data;
            const decoded = jwt.verify(token, JWT_SECRET);

            socket.userId = decoded.userId;
            socket.username = decoded.username;

            onlineUsers.set(socket.id, decoded.userId);
            userSockets.set(decoded.userId, socket.id);

            // Get user info
            const user = db.getUserById(decoded.userId);

            // Send authentication success
            socket.emit('authenticated', {
                success: true,
                user
            });

            // Broadcast user online status
            io.emit('user-status', {
                userId: decoded.userId,
                username: decoded.username,
                online: true
            });

            // Send online users list
            const onlineUsersList = Array.from(userSockets.keys());
            socket.emit('online-users', { users: onlineUsersList });

            console.log(`✅ User authenticated: ${decoded.username} (ID: ${decoded.userId})`);
        } catch (error) {
            socket.emit('auth-error', { error: 'Invalid token' });
        }
    });

    // Send message
    socket.on('send-message', (data) => {
        try {
            const { receiverId, message } = data;

            if (!socket.userId) {
                socket.emit('error', { error: 'Not authenticated' });
                return;
            }

            // Save message to database
            const savedMessage = db.createMessage(socket.userId, receiverId, message);

            // Get sender info
            const sender = db.getUserById(socket.userId);

            const messageData = {
                id: savedMessage.id,
                senderId: socket.userId,
                senderUsername: sender.username,
                senderAvatar: sender.avatar,
                receiverId,
                message: savedMessage.message,
                read: false,
                createdAt: savedMessage.created_at
            };

            // Send to receiver if online
            const receiverSocketId = userSockets.get(receiverId);
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('new-message', messageData);
            }

            // Confirm to sender
            socket.emit('message-sent', messageData);

            console.log(`📨 Message from ${sender.username} to user ${receiverId}`);
        } catch (error) {
            socket.emit('error', { error: error.message });
        }
    });

    // Typing indicator
    socket.on('typing', (data) => {
        const { receiverId, isTyping } = data;
        const receiverSocketId = userSockets.get(receiverId);

        if (receiverSocketId) {
            io.to(receiverSocketId).emit('user-typing', {
                userId: socket.userId,
                username: socket.username,
                isTyping
            });
        }
    });

    // Mark messages as read
    socket.on('mark-read', (data) => {
        try {
            const { senderId } = data;

            if (!socket.userId) return;

            db.markMessagesAsRead(senderId, socket.userId);

            // Notify sender that messages were read
            const senderSocketId = userSockets.get(senderId);
            if (senderSocketId) {
                io.to(senderSocketId).emit('messages-read', {
                    userId: socket.userId
                });
            }
        } catch (error) {
            console.error('Error marking messages as read:', error);
        }
    });

    // Edit message
    socket.on('edit-message', (data) => {
        try {
            const { messageId, message, receiverId } = data;

            if (!socket.userId) {
                socket.emit('error', { error: 'Not authenticated' });
                return;
            }

            const updatedMessage = db.editMessage(messageId, message, socket.userId);

            // Notify receiver if online
            const receiverSocketId = userSockets.get(receiverId);
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('message-edited', {
                    messageId,
                    message: updatedMessage.message,
                    edited: true
                });
            }

            // Confirm to sender
            socket.emit('message-edit-confirmed', {
                messageId,
                message: updatedMessage.message,
                edited: true
            });

            console.log(`✏️ Message ${messageId} edited by user ${socket.userId}`);
        } catch (error) {
            socket.emit('error', { error: error.message });
        }
    });

    // Delete message
    socket.on('delete-message', (data) => {
        try {
            const { messageId, deleteForEveryone, receiverId } = data;

            if (!socket.userId) {
                socket.emit('error', { error: 'Not authenticated' });
                return;
            }

            const result = db.deleteMessage(messageId, socket.userId, deleteForEveryone);

            if (deleteForEveryone) {
                // Notify receiver if online
                const receiverSocketId = userSockets.get(receiverId);
                if (receiverSocketId) {
                    io.to(receiverSocketId).emit('message-deleted', {
                        messageId,
                        deleteForEveryone: true
                    });
                }
            }

            // Confirm to sender
            socket.emit('message-delete-confirmed', {
                messageId,
                deleteForEveryone
            });

            console.log(`🗑️ Message ${messageId} deleted by user ${socket.userId}`);
        } catch (error) {
            socket.emit('error', { error: error.message });
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        if (socket.userId) {
            onlineUsers.delete(socket.id);
            userSockets.delete(socket.userId);

            // Broadcast user offline status
            io.emit('user-status', {
                userId: socket.userId,
                username: socket.username,
                online: false
            });

            console.log(`👋 User disconnected: ${socket.username}`);
        } else {
            console.log('🔌 Connection closed:', socket.id);
        }
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║      CrazyChat Server Running        ║
║   Port: ${PORT}                         ║
║   http://localhost:${PORT}              ║
╚═══════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    db.close();
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
