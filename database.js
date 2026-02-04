const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const bcrypt = require('bcryptjs');
const path = require('path');

class ChatDatabase {
    constructor() {
        const adapter = new FileSync(path.join(__dirname, 'db.json'));
        this.db = low(adapter);

        // Initialize database structure
        this.db.defaults({ users: [], messages: [], contacts: [], blocked: [] }).write();

        console.log('✅ Database initialized');
    }

    // User operations
    createUser(username, password, email) {
        const existingUser = this.db.get('users').find({ username }).value();
        if (existingUser) {
            throw new Error('Username already exists');
        }

        const existingEmail = this.db.get('users').find({ email }).value();
        if (existingEmail) {
            throw new Error('Email already exists');
        }

        const hashedPassword = bcrypt.hashSync(password, 10);
        const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff&size=50`;

        const user = {
            id: Date.now(),
            username,
            email,
            password: hashedPassword,
            avatar,
            created_at: new Date().toISOString()
        };

        this.db.get('users').push(user).write();

        return {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar: user.avatar
        };
    }

    getUserByEmail(email) {
        return this.db.get('users').find({ email }).value();
    }

    getUserByUsername(username) {
        return this.db.get('users').find({ username }).value();
    }

    getUserById(id) {
        const user = this.db.get('users').find({ id }).value();
        if (!user) return null;

        return {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar: user.avatar,
            created_at: user.created_at
        };
    }

    getAllUsers() {
        return this.db.get('users')
            .map(u => ({
                id: u.id,
                username: u.username,
                email: u.email,
                avatar: u.avatar,
                created_at: u.created_at
            }))
            .sortBy('username')
            .value();
    }

    verifyPassword(username, password) {
        const user = this.getUserByUsername(username);
        if (!user) return null;

        const isValid = bcrypt.compareSync(password, user.password);
        if (!isValid) return null;

        return {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar: user.avatar
        };
    }

    // Contact operations
    addContact(userId, contactEmail, contactName) {
        // Find user by email
        const contactUser = this.getUserByEmail(contactEmail);
        if (!contactUser) {
            throw new Error('User with this email not found');
        }

        // Check if contact already exists
        const existingContact = this.db.get('contacts')
            .find({ user_id: userId, contact_id: contactUser.id })
            .value();

        if (existingContact) {
            throw new Error('Contact already exists');
        }

        const contact = {
            id: Date.now(),
            user_id: userId,
            contact_id: contactUser.id,
            contact_name: contactName || contactUser.username,
            created_at: new Date().toISOString()
        };

        this.db.get('contacts').push(contact).write();

        return {
            ...contact,
            contact_username: contactUser.username,
            contact_email: contactUser.email,
            contact_avatar: contactUser.avatar
        };
    }

    getContacts(userId) {
        const contacts = this.db.get('contacts')
            .filter({ user_id: userId })
            .value();

        return contacts.map(c => {
            const contactUser = this.getUserById(c.contact_id);
            return {
                id: c.id,
                contact_id: c.contact_id,
                contact_name: c.contact_name,
                contact_username: contactUser?.username,
                contact_email: contactUser?.email,
                contact_avatar: contactUser?.avatar,
                created_at: c.created_at
            };
        });
    }

    deleteContact(userId, contactId) {
        this.db.get('contacts')
            .remove({ user_id: userId, id: contactId })
            .write();
    }

    // Blocking operations
    blockContact(userId, blockedUserId) {
        // Check if already blocked
        const existing = this.db.get('blocked')
            .find({ user_id: userId, blocked_user_id: blockedUserId })
            .value();

        if (existing) {
            throw new Error('User already blocked');
        }

        const block = {
            id: Date.now(),
            user_id: userId,
            blocked_user_id: blockedUserId,
            created_at: new Date().toISOString()
        };

        this.db.get('blocked').push(block).write();
        return block;
    }

    unblockContact(userId, blockedUserId) {
        this.db.get('blocked')
            .remove({ user_id: userId, blocked_user_id: blockedUserId })
            .write();
    }

    isBlocked(userId, otherUserId) {
        const blocked = this.db.get('blocked')
            .find({ user_id: userId, blocked_user_id: otherUserId })
            .value();
        return !!blocked;
    }

    getBlockedContacts(userId) {
        const blocked = this.db.get('blocked')
            .filter({ user_id: userId })
            .value();

        return blocked.map(b => {
            const user = this.getUserById(b.blocked_user_id);
            return {
                id: b.id,
                blocked_user_id: b.blocked_user_id,
                blocked_username: user?.username,
                blocked_email: user?.email,
                blocked_avatar: user?.avatar,
                created_at: b.created_at
            };
        });
    }

    // Message operations
    createMessage(senderId, receiverId, message) {
        const msg = {
            id: Date.now(),
            sender_id: senderId,
            receiver_id: receiverId,
            message,
            read: false,
            edited: false,
            deleted: false,
            created_at: new Date().toISOString()
        };

        this.db.get('messages').push(msg).write();

        return msg;
    }

    editMessage(messageId, newMessage, userId) {
        const message = this.db.get('messages').find({ id: messageId }).value();

        if (!message) {
            throw new Error('Message not found');
        }

        if (message.sender_id !== userId) {
            throw new Error('Not authorized to edit this message');
        }

        this.db.get('messages')
            .find({ id: messageId })
            .assign({
                message: newMessage,
                edited: true,
                edited_at: new Date().toISOString()
            })
            .write();

        return this.db.get('messages').find({ id: messageId }).value();
    }

    deleteMessage(messageId, userId, deleteForEveryone = false) {
        const message = this.db.get('messages').find({ id: messageId }).value();

        if (!message) {
            throw new Error('Message not found');
        }

        if (message.sender_id !== userId && !deleteForEveryone) {
            throw new Error('Not authorized to delete this message');
        }

        if (deleteForEveryone) {
            // Delete for everyone - mark as deleted
            this.db.get('messages')
                .find({ id: messageId })
                .assign({
                    deleted: true,
                    message: 'Diese Nachricht wurde gelöscht',
                    deleted_at: new Date().toISOString()
                })
                .write();
        } else {
            // Delete for me - actually remove from database
            this.db.get('messages')
                .remove({ id: messageId })
                .write();
        }

        return { success: true, deleteForEveryone };
    }

    getMessagesBetweenUsers(userId1, userId2, limit = 50) {
        const messages = this.db.get('messages')
            .filter(m =>
                (m.sender_id === userId1 && m.receiver_id === userId2) ||
                (m.sender_id === userId2 && m.receiver_id === userId1)
            )
            .orderBy('created_at', 'desc')
            .take(limit)
            .value();

        // Add user info
        const enrichedMessages = messages.map(m => {
            const sender = this.getUserById(m.sender_id);
            const receiver = this.getUserById(m.receiver_id);
            return {
                ...m,
                sender_username: sender?.username,
                sender_avatar: sender?.avatar,
                receiver_username: receiver?.username,
                receiver_avatar: receiver?.avatar
            };
        });

        return enrichedMessages.reverse(); // Return in chronological order
    }

    markMessagesAsRead(senderId, receiverId) {
        const messages = this.db.get('messages')
            .filter(m => m.sender_id === senderId && m.receiver_id === receiverId && !m.read)
            .value();

        messages.forEach(m => {
            this.db.get('messages')
                .find({ id: m.id })
                .assign({ read: true })
                .write();
        });

        return messages.length;
    }

    getUnreadCount(userId) {
        const unreadMessages = this.db.get('messages')
            .filter(m => m.receiver_id === userId && !m.read)
            .value();

        const counts = {};
        unreadMessages.forEach(m => {
            counts[m.sender_id] = (counts[m.sender_id] || 0) + 1;
        });

        return Object.entries(counts).map(([sender_id, count]) => ({
            sender_id: parseInt(sender_id),
            count
        }));
    }

    getLastMessageWithUser(userId, otherUserId) {
        return this.db.get('messages')
            .filter(m =>
                (m.sender_id === userId && m.receiver_id === otherUserId) ||
                (m.sender_id === otherUserId && m.receiver_id === userId)
            )
            .orderBy('created_at', 'desc')
            .first()
            .value();
    }

    getChatList(userId) {
        const allMessages = this.db.get('messages')
            .filter(m => m.sender_id === userId || m.receiver_id === userId)
            .value();

        const chatMap = new Map();

        allMessages.forEach(m => {
            const otherUserId = m.sender_id === userId ? m.receiver_id : m.sender_id;
            const existing = chatMap.get(otherUserId);

            if (!existing || new Date(m.created_at) > new Date(existing.created_at)) {
                chatMap.set(otherUserId, m);
            }
        });

        const chats = Array.from(chatMap.entries()).map(([otherUserId, lastMsg]) => {
            const user = this.getUserById(otherUserId);
            const unreadCount = this.db.get('messages')
                .filter(m => m.sender_id === otherUserId && m.receiver_id === userId && !m.read)
                .size()
                .value();

            return {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar,
                last_message: lastMsg.message,
                last_message_time: lastMsg.created_at,
                is_sent: lastMsg.sender_id === userId,
                unread_count: unreadCount
            };
        });

        return chats.sort((a, b) =>
            new Date(b.last_message_time) - new Date(a.last_message_time)
        );
    }

    close() {
        // No need to close lowdb
    }
}

module.exports = ChatDatabase;
