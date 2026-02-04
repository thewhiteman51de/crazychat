// ===== Configuration =====
const API_URL = window.location.origin; // Automatically uses correct URL (localhost or production)
let socket = null;
let currentUser = null;
let currentChat = null;
let users = [];
let onlineUsers = new Set();
let contextMenuMessage = null; // For context menu

// ===== Initialize App =====
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupAuthListeners();
});

// ===== Authentication =====
function checkAuth() {
    const token = localStorage.getItem('auth-token');
    const user = localStorage.getItem('user-data');

    if (token && user) {
        currentUser = JSON.parse(user);
        connectWebSocket(token);
        showApp();
    } else {
        showAuthModal();
    }
}

function showAuthModal() {
    document.getElementById('authModal').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
}

function showApp() {
    document.getElementById('authModal').style.display = 'none';
    document.getElementById('appContainer').style.display = 'grid';

    // Update user profile
    const userAvatar = document.querySelector('.user-profile .avatar');
    if (currentUser && userAvatar) {
        userAvatar.src = currentUser.avatar;
        userAvatar.alt = currentUser.username;
    }

    setupEventListeners();
    loadUsers();
}

function setupAuthListeners() {
    // Toggle between login and register
    document.getElementById('showRegister').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('loginForm').classList.add('hidden');
        document.getElementById('registerForm').classList.remove('hidden');
        clearErrors();
    });

    document.getElementById('showLogin').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('registerForm').classList.add('hidden');
        document.getElementById('loginForm').classList.remove('hidden');
        clearErrors();
    });

    // Login
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
    document.getElementById('loginPassword').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // Register
    document.getElementById('registerBtn').addEventListener('click', handleRegister);
    document.getElementById('registerPasswordConfirm').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleRegister();
    });
}

async function handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');

    if (!username || !password) {
        errorEl.textContent = 'Bitte alle Felder ausfüllen';
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (!response.ok) {
            errorEl.textContent = data.error || 'Login fehlgeschlagen';
            return;
        }

        // Save auth data
        localStorage.setItem('auth-token', data.token);
        localStorage.setItem('user-data', JSON.stringify(data.user));
        currentUser = data.user;

        // Connect to WebSocket
        connectWebSocket(data.token);
        showApp();

    } catch (error) {
        errorEl.textContent = 'Verbindungsfehler. Ist der Server gestartet?';
        console.error('Login error:', error);
    }
}

async function handleRegister() {
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
    const errorEl = document.getElementById('registerError');

    if (!username || !email || !password || !passwordConfirm) {
        errorEl.textContent = 'Bitte alle Felder ausfüllen';
        return;
    }

    if (password !== passwordConfirm) {
        errorEl.textContent = 'Passwörter stimmen nicht überein';
        return;
    }

    if (password.length < 6) {
        errorEl.textContent = 'Passwort muss mindestens 6 Zeichen lang sein';
        return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        errorEl.textContent = 'Ungültige Email-Adresse';
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, email })
        });

        const data = await response.json();

        if (!response.ok) {
            errorEl.textContent = data.error || 'Registrierung fehlgeschlagen';
            return;
        }

        // Save auth data
        localStorage.setItem('auth-token', data.token);
        localStorage.setItem('user-data', JSON.stringify(data.user));
        currentUser = data.user;

        // Connect to WebSocket
        connectWebSocket(data.token);
        showApp();

    } catch (error) {
        errorEl.textContent = 'Verbindungsfehler. Ist der Server gestartet?';
        console.error('Register error:', error);
    }
}

function clearErrors() {
    document.getElementById('loginError').textContent = '';
    document.getElementById('registerError').textContent = '';
}

function logout() {
    localStorage.removeItem('auth-token');
    localStorage.removeItem('user-data');
    if (socket) {
        socket.disconnect();
    }
    currentUser = null;
    currentChat = null;
    showAuthModal();
}

// ===== WebSocket Connection =====
function connectWebSocket(token) {
    socket = io(API_URL);

    socket.on('connect', () => {
        console.log('🔌 Connected to server');
        socket.emit('authenticate', { token });
    });

    socket.on('authenticated', (data) => {
        console.log('✅ Authenticated:', data.user.username);
        currentUser = data.user;
    });

    socket.on('auth-error', (data) => {
        console.error('❌ Auth error:', data.error);
        logout();
    });

    socket.on('online-users', (data) => {
        onlineUsers = new Set(data.users);
        updateOnlineStatus();
    });

    socket.on('user-status', (data) => {
        if (data.online) {
            onlineUsers.add(data.userId);
        } else {
            onlineUsers.delete(data.userId);
        }
        updateOnlineStatus();
    });

    socket.on('new-message', (data) => {
        handleIncomingMessage(data);
    });

    socket.on('message-sent', (data) => {
        // Message was successfully sent
        if (currentChat && (data.receiverId === currentChat.id)) {
            addMessageToUI(data, true);
        }
    });

    socket.on('user-typing', (data) => {
        if (currentChat && data.userId === currentChat.id) {
            showTypingIndicator(data.isTyping);
        }
    });

    socket.on('messages-read', (data) => {
        if (currentChat && data.userId === currentChat.id) {
            markMessagesAsReadInUI();
        }
    });

    socket.on('disconnect', () => {
        console.log('🔌 Disconnected from server');
    });

    socket.on('error', (data) => {
        console.error('❌ Socket error:', data.error);
    });

    // Message editing/deletion events
    socket.on('message-edited', (data) => {
        updateMessageInUI(data.messageId, data.message, true);
    });

    socket.on('message-edit-confirmed', (data) => {
        updateMessageInUI(data.messageId, data.message, true);
    });

    socket.on('message-deleted', (data) => {
        if (data.deleteForEveryone) {
            updateMessageInUI(data.messageId, 'Diese Nachricht wurde gelöscht', false, true);
        }
    });

    socket.on('message-delete-confirmed', (data) => {
        if (data.deleteForEveryone) {
            updateMessageInUI(data.messageId, 'Diese Nachricht wurde gelöscht', false, true);
        } else {
            removeMessageFromUI(data.messageId);
        }
    });
}

// ===== Load Users =====
async function loadUsers() {
    try {
        // Load contacts
        const contactsResponse = await fetch(`${API_URL}/api/contacts/${currentUser.id}`);
        const contactsData = await contactsResponse.json();

        const contacts = contactsData.contacts.map(c => ({
            id: c.contact_id,
            username: c.contact_name,
            email: c.contact_email,
            avatar: c.contact_avatar,
            isSaved: true
        }));

        // Load chat list to find users who messaged us but aren't saved
        const chatsResponse = await fetch(`${API_URL}/api/chats/${currentUser.id}`);
        const chatsData = await chatsResponse.json();

        // Get all users we've chatted with
        const contactIds = new Set(contacts.map(c => c.id));
        const unknownUsers = chatsData.chats
            .filter(chat => !contactIds.has(chat.id))
            .map(chat => ({
                id: chat.id,
                username: chat.email || chat.username, // Show email for unknown contacts
                email: chat.email,
                avatar: chat.avatar,
                isSaved: false
            }));

        // Combine contacts and unknown users
        users = [...contacts, ...unknownUsers];

        renderUserList();

    } catch (error) {
        console.error('Error loading contacts:', error);
    }
}

function renderUserList() {
    const chatList = document.getElementById('chatList');
    chatList.innerHTML = '';

    users.forEach(user => {
        const chatItem = createUserItem(user);
        chatList.appendChild(chatItem);
    });
}

function createUserItem(user) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    if (currentChat && currentChat.id === user.id) {
        div.classList.add('active');
    }

    const isOnline = onlineUsers.has(user.id);
    const displayName = user.isSaved ? user.username : user.email;
    const subtitle = user.isSaved ? '' : '<span class="unknown-contact">Nicht gespeichert</span>';

    div.innerHTML = `
        <div class="chat-item-avatar">
            <img src="${user.avatar}" alt="${displayName}" class="avatar">
            ${isOnline ? '<div class="online-indicator"></div>' : ''}
        </div>
        <div class="chat-item-content">
            <div class="chat-item-header">
                <span class="chat-item-name">${displayName}</span>
                <span class="chat-item-time"></span>
            </div>
            <div class="chat-item-message">
                <span class="chat-item-last-message">${subtitle || 'Klicken zum Chatten'}</span>
            </div>
        </div>
    `;

    div.addEventListener('click', () => openChat(user));

    return div;
}

function updateOnlineStatus() {
    renderUserList();

    if (currentChat) {
        const isOnline = onlineUsers.has(currentChat.id);
        document.getElementById('chatStatus').textContent = isOnline ? 'online' : 'offline';
    }
}

// ===== Chat Functions =====
async function openChat(user) {
    currentChat = user;

    // Update UI
    document.getElementById('welcomeScreen').style.display = 'none';
    document.getElementById('chatScreen').style.display = 'flex';

    // Update header - show email for unknown contacts
    const displayName = user.isSaved ? user.username : user.email;
    document.getElementById('chatAvatar').src = user.avatar;
    document.getElementById('chatName').textContent = displayName;
    const isOnline = onlineUsers.has(user.id);
    document.getElementById('chatStatus').textContent = isOnline ? 'online' : 'offline';

    // Show/hide save contact button
    const saveBtn = document.getElementById('saveContactBtn');
    const deleteBtn = document.getElementById('deleteContactBtn');
    const blockBtn = document.getElementById('blockContactBtn');

    if (user.isSaved) {
        saveBtn.style.display = 'none';
        deleteBtn.style.display = 'flex';
        blockBtn.style.display = 'flex';
    } else {
        saveBtn.style.display = 'flex';
        deleteBtn.style.display = 'none';
        blockBtn.style.display = 'none';
    }

    // Load messages
    await loadMessages(user.id);

    // Mark messages as read
    socket.emit('mark-read', { senderId: user.id });

    // Update chat list
    renderUserList();

    // Focus input
    document.getElementById('messageInput').focus();
}

async function loadMessages(userId) {
    try {
        const response = await fetch(`${API_URL}/api/messages/${currentUser.id}/${userId}`);
        const data = await response.json();

        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';

        data.messages.forEach(msg => {
            const isSent = msg.sender_id === currentUser.id;
            addMessageToUI({
                id: msg.id,
                message: msg.message,
                createdAt: msg.created_at,
                read: msg.read,
                edited: msg.edited,
                deleted: msg.deleted
            }, isSent);
        });

        container.scrollTop = container.scrollHeight;

    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

function handleIncomingMessage(data) {
    // Play notification sound (optional)
    // new Audio('/notification.mp3').play();

    if (currentChat && data.senderId === currentChat.id) {
        addMessageToUI(data, false);
        socket.emit('mark-read', { senderId: data.senderId });
    } else {
        // Message from someone not currently in chat - reload user list to show them
        loadUsers();
    }
}

function addMessageToUI(data, isSent) {
    const container = document.getElementById('messagesContainer');
    const messageEl = createMessageElement(data, isSent);
    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
}

function createMessageElement(data, isSent) {
    const div = document.createElement('div');
    div.className = `message ${isSent ? 'sent' : 'received'}`;
    div.dataset.messageId = data.id;

    const time = formatMessageTime(data.createdAt);
    const editedLabel = data.edited ? ' <span style="font-size: 11px; opacity: 0.7;">(bearbeitet)</span>' : '';
    const messageText = data.deleted ? '<em style="opacity: 0.6;">Diese Nachricht wurde gelöscht</em>' : escapeHtml(data.message);

    const checkmarks = isSent ? `
        <div class="message-status">
            <svg class="checkmark ${data.read ? 'read' : ''}" viewBox="0 0 16 15" width="16" height="15">
                <path fill="currentColor" d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z"/>
            </svg>
        </div>
    ` : '';

    div.innerHTML = `
        <div class="message-bubble">
            <div class="message-text">${messageText}${editedLabel}</div>
            <div class="message-meta">
                <span class="message-time">${time}</span>
                ${checkmarks}
            </div>
        </div>
    `;

    // Add right-click context menu for sent messages
    if (isSent && !data.deleted) {
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showMessageContextMenu(e, data);
        });
    }

    return div;
}

function markMessagesAsReadInUI() {
    const checkmarks = document.querySelectorAll('.message.sent .checkmark');
    checkmarks.forEach(check => check.classList.add('read'));
}

// ===== Event Listeners =====
function setupEventListeners() {
    // Search functionality
    document.getElementById('searchInput').addEventListener('input', handleSearch);

    // Message input
    const messageInput = document.getElementById('messageInput');
    let typingTimer;

    messageInput.addEventListener('input', () => {
        if (currentChat && socket) {
            clearTimeout(typingTimer);
            socket.emit('typing', { receiverId: currentChat.id, isTyping: true });

            typingTimer = setTimeout(() => {
                socket.emit('typing', { receiverId: currentChat.id, isTyping: false });
            }, 1000);
        }
    });

    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    // Send button
    document.getElementById('sendBtn').addEventListener('click', sendMessage);

    // Emoji picker
    document.getElementById('emojiBtn').addEventListener('click', toggleEmojiPicker);

    // Close emoji picker when clicking outside
    document.addEventListener('click', (e) => {
        const emojiPicker = document.getElementById('emojiPicker');
        const emojiBtn = document.getElementById('emojiBtn');
        if (!emojiPicker.contains(e.target) && !emojiBtn.contains(e.target)) {
            emojiPicker.style.display = 'none';
        }
    });

    // Emoji selection
    document.getElementById('emojiPicker').addEventListener('click', (e) => {
        if (e.target.textContent && e.target.textContent.trim().length === 2) {
            insertEmoji(e.target.textContent.trim());
        }
    });

    // Contact modal
    document.getElementById('newContactBtn').addEventListener('click', openContactModal);
    document.getElementById('closeContactModal').addEventListener('click', closeContactModal);
    document.getElementById('addContactBtn').addEventListener('click', addContact);

    // Save contact button in chat header
    document.getElementById('saveContactBtn').addEventListener('click', saveCurrentContact);

    // Close contact modal when clicking outside
    document.getElementById('contactModal').addEventListener('click', (e) => {
        if (e.target.id === 'contactModal') {
            closeContactModal();
        }
    });

    // Enter key in contact inputs
    document.getElementById('contactEmail').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addContact();
    });
    document.getElementById('contactName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addContact();
    });

    // Menu button - add logout
    document.getElementById('menuBtn').addEventListener('click', async () => {
        const confirmed = await showConfirm('Möchtest du dich abmelden?', 'Abmelden');
        if (confirmed) {
            logout();
        }
    });

    // Delete and block contact buttons
    document.getElementById('deleteContactBtn').addEventListener('click', deleteCurrentContact);
    document.getElementById('blockContactBtn').addEventListener('click', blockCurrentContact);

    // Context menu for messages
    document.getElementById('editMessageBtn').addEventListener('click', handleEditMessage);
    document.getElementById('deleteForMeBtn').addEventListener('click', () => handleDeleteMessage(false));
    document.getElementById('deleteForEveryoneBtn').addEventListener('click', () => handleDeleteMessage(true));

    // Close context menu when clicking outside
    document.addEventListener('click', (e) => {
        const contextMenu = document.getElementById('messageContextMenu');
        if (!contextMenu.contains(e.target)) {
            contextMenu.style.display = 'none';
        }
    });
}

// ===== Custom Modal Functions =====
function showConfirm(message, title = 'Bestätigen') {
    return new Promise((resolve) => {
        const modal = document.getElementById('customConfirmModal');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const okBtn = document.getElementById('confirmOkBtn');
        const cancelBtn = document.getElementById('confirmCancelBtn');

        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.style.display = 'flex';

        const handleOk = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
        };

        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
    });
}

function showPrompt(message, defaultValue = '', title = 'Eingabe') {
    return new Promise((resolve) => {
        const modal = document.getElementById('customPromptModal');
        const titleEl = document.getElementById('promptTitle');
        const messageEl = document.getElementById('promptMessage');
        const input = document.getElementById('promptInput');
        const okBtn = document.getElementById('promptOkBtn');
        const cancelBtn = document.getElementById('promptCancelBtn');

        titleEl.textContent = title;
        messageEl.textContent = message;
        input.value = defaultValue;
        modal.style.display = 'flex';

        // Focus input after a short delay
        setTimeout(() => {
            input.focus();
            input.select();
        }, 100);

        const handleOk = () => {
            const value = input.value.trim();
            modal.style.display = 'none';
            cleanup();
            resolve(value || null);
        };

        const handleCancel = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(null);
        };

        const handleEnter = (e) => {
            if (e.key === 'Enter') {
                handleOk();
            } else if (e.key === 'Escape') {
                handleCancel();
            }
        };

        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            input.removeEventListener('keypress', handleEnter);
        };

        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        input.addEventListener('keypress', handleEnter);
    });
}

function showAlert(message, title = 'Hinweis') {
    return new Promise((resolve) => {
        const modal = document.getElementById('customAlertModal');
        const titleEl = document.getElementById('alertTitle');
        const messageEl = document.getElementById('alertMessage');
        const okBtn = document.getElementById('alertOkBtn');

        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.style.display = 'flex';

        const handleOk = () => {
            modal.style.display = 'none';
            cleanup();
            resolve();
        };

        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
        };

        okBtn.addEventListener('click', handleOk);
    });
}

// ===== Contact Management =====
function openContactModal() {
    document.getElementById('contactModal').style.display = 'flex';
    document.getElementById('contactEmail').value = '';
    document.getElementById('contactName').value = '';
    document.getElementById('contactError').textContent = '';
    document.getElementById('contactEmail').focus();
}

function closeContactModal() {
    document.getElementById('contactModal').style.display = 'none';
}

async function saveCurrentContact() {
    if (!currentChat || currentChat.isSaved) {
        return;
    }

    const name = await showPrompt('Name für diesen Kontakt:', currentChat.username, 'Kontakt speichern');
    if (!name) return;

    try {
        const response = await fetch(`${API_URL}/api/contacts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.id,
                contactEmail: currentChat.email,
                contactName: name
            })
        });

        const data = await response.json();

        if (!response.ok) {
            await showAlert('Fehler: ' + (data.error || 'Kontakt konnte nicht gespeichert werden'), 'Fehler');
            return;
        }

        // Update current chat to saved
        currentChat.isSaved = true;
        currentChat.username = name;

        // Hide save button
        document.getElementById('saveContactBtn').style.display = 'none';

        // Update chat name
        document.getElementById('chatName').textContent = name;

        // Reload user list
        await loadUsers();

    } catch (error) {
        await showAlert('Verbindungsfehler', 'Fehler');
        console.error('Save contact error:', error);
    }
}

async function addContact() {
    const email = document.getElementById('contactEmail').value.trim();
    const name = document.getElementById('contactName').value.trim();
    const errorEl = document.getElementById('contactError');

    if (!email) {
        errorEl.textContent = 'Bitte Email-Adresse eingeben';
        return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        errorEl.textContent = 'Ungültige Email-Adresse';
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/contacts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.id,
                contactEmail: email,
                contactName: name
            })
        });

        const data = await response.json();

        if (!response.ok) {
            errorEl.textContent = data.error || 'Fehler beim Hinzufügen';
            return;
        }

        // Close modal and reload contacts
        closeContactModal();
        await loadUsers();

    } catch (error) {
        errorEl.textContent = 'Verbindungsfehler';
        console.error('Add contact error:', error);
    }
}

// ===== Message Functions =====
function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();

    if (!text || !currentChat || !socket) return;

    socket.emit('send-message', {
        receiverId: currentChat.id,
        message: text
    });

    // Clear input
    input.value = '';

    // Stop typing indicator
    socket.emit('typing', { receiverId: currentChat.id, isTyping: false });
}

function showTypingIndicator(isTyping) {
    const indicator = document.getElementById('typingIndicator');
    indicator.style.display = isTyping ? 'block' : 'none';

    if (isTyping) {
        const container = document.getElementById('messagesContainer');
        container.scrollTop = container.scrollHeight;
    }
}

// ===== Search Function =====
function handleSearch(e) {
    const query = e.target.value.toLowerCase();
    const filteredUsers = users.filter(u =>
        u.username.toLowerCase().includes(query)
    );

    const chatList = document.getElementById('chatList');
    chatList.innerHTML = '';

    filteredUsers.forEach(user => {
        const chatItem = createUserItem(user);
        chatList.appendChild(chatItem);
    });
}

// ===== Emoji Functions =====
function toggleEmojiPicker(e) {
    e.stopPropagation();
    const picker = document.getElementById('emojiPicker');
    picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
}

function insertEmoji(emoji) {
    const input = document.getElementById('messageInput');
    input.value += emoji;
    input.focus();
}

// ===== Utility Functions =====
function formatMessageTime(timestamp) {
    const date = new Date(timestamp);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== Message Context Menu =====
function showMessageContextMenu(e, messageData) {
    const contextMenu = document.getElementById('messageContextMenu');
    contextMenuMessage = messageData;

    // Position the menu
    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.top = `${e.pageY}px`;
    contextMenu.style.display = 'block';
}

async function handleEditMessage() {
    if (!contextMenuMessage) return;

    const newMessage = await showPrompt('Nachricht bearbeiten:', contextMenuMessage.message, 'Bearbeiten');
    if (!newMessage || newMessage === contextMenuMessage.message) {
        document.getElementById('messageContextMenu').style.display = 'none';
        return;
    }

    socket.emit('edit-message', {
        messageId: contextMenuMessage.id,
        message: newMessage,
        receiverId: currentChat.id
    });

    document.getElementById('messageContextMenu').style.display = 'none';
}

async function handleDeleteMessage(deleteForEveryone) {
    if (!contextMenuMessage) return;

    const confirmMsg = deleteForEveryone
        ? 'Nachricht für alle löschen?'
        : 'Nachricht für dich löschen?';

    const confirmed = await showConfirm(confirmMsg, 'Nachricht löschen');
    if (!confirmed) {
        document.getElementById('messageContextMenu').style.display = 'none';
        return;
    }

    socket.emit('delete-message', {
        messageId: contextMenuMessage.id,
        deleteForEveryone,
        receiverId: currentChat.id
    });

    document.getElementById('messageContextMenu').style.display = 'none';
}

function updateMessageInUI(messageId, newMessage, edited, deleted = false) {
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageEl) return;

    const textEl = messageEl.querySelector('.message-text');
    if (!textEl) return;

    if (deleted) {
        textEl.innerHTML = '<em style="opacity: 0.6;">Diese Nachricht wurde gelöscht</em>';
    } else {
        const editedLabel = edited ? ' <span style="font-size: 11px; opacity: 0.7;">(bearbeitet)</span>' : '';
        textEl.innerHTML = escapeHtml(newMessage) + editedLabel;
    }
}

function removeMessageFromUI(messageId) {
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageEl) {
        messageEl.remove();
    }
}

// ===== Contact Management Functions =====
async function deleteCurrentContact() {
    if (!currentChat || !currentChat.isSaved) return;

    const confirmed = await showConfirm(`Kontakt "${currentChat.username}" löschen?`, 'Kontakt löschen');
    if (!confirmed) return;

    try {
        // Find contact ID
        const contactsResponse = await fetch(`${API_URL}/api/contacts/${currentUser.id}`);
        const contactsData = await contactsResponse.json();
        const contact = contactsData.contacts.find(c => c.contact_id === currentChat.id);

        if (!contact) {
            await showAlert('Kontakt nicht gefunden', 'Fehler');
            return;
        }

        const response = await fetch(`${API_URL}/api/contacts/${currentUser.id}/${contact.id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            await showAlert('Fehler beim Löschen', 'Fehler');
            return;
        }

        // Close chat and reload users
        document.getElementById('welcomeScreen').style.display = 'flex';
        document.getElementById('chatScreen').style.display = 'none';
        currentChat = null;
        await loadUsers();

    } catch (error) {
        await showAlert('Verbindungsfehler', 'Fehler');
        console.error('Delete contact error:', error);
    }
}

async function blockCurrentContact() {
    if (!currentChat) return;

    const confirmed = await showConfirm(`Benutzer "${currentChat.username || currentChat.email}" blockieren?`, 'Blockieren');
    if (!confirmed) return;

    try {
        const response = await fetch(`${API_URL}/api/contacts/block`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.id,
                blockedUserId: currentChat.id
            })
        });

        const data = await response.json();

        if (!response.ok) {
            await showAlert('Fehler: ' + (data.error || 'Blockieren fehlgeschlagen'), 'Fehler');
            return;
        }

        await showAlert('Benutzer wurde blockiert', 'Blockiert');

        // Close chat and reload users
        document.getElementById('welcomeScreen').style.display = 'flex';
        document.getElementById('chatScreen').style.display = 'none';
        currentChat = null;
        await loadUsers();

    } catch (error) {
        await showAlert('Verbindungsfehler', 'Fehler');
        console.error('Block contact error:', error);
    }
}
