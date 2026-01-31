const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- STATE ---
let users = {};
let messages = [];
let mediaGallery = [];
let kickVotes = {}; // { targetId: [voterId, voterId] }
const WIPE_INTERVAL = 15 * 60 * 1000; // 15 Minutes

// --- 15 MINUTE WIPER ---
let wipeTimer = setTimeout(wipeData, WIPE_INTERVAL);
let nextWipeTime = Date.now() + WIPE_INTERVAL;

function wipeData() {
    console.log("--- SYSTEM WIPE ---");
    users = {};
    messages = [];
    mediaGallery = [];
    kickVotes = {};
    io.emit('system-wipe');
    
    // Reset Timer
    nextWipeTime = Date.now() + WIPE_INTERVAL;
    wipeTimer = setTimeout(wipeData, WIPE_INTERVAL);
}

// Send time remaining to new users
setInterval(() => {
    io.emit('timer-update', (nextWipeTime - Date.now()));
}, 1000);

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Initialize User
    users[socket.id] = { 
        id: socket.id, 
        name: 'Anon', 
        color: '#00ffcc',
        warnings: 0,
        mutedUntil: 0 
    };

    io.emit('user-count', Object.keys(users).length);

    // Join/Setup Profile
    socket.on('set-profile', (data) => {
        if(users[socket.id]) {
            users[socket.id].name = data.name || users[socket.id].name;
            users[socket.id].color = data.color || users[socket.id].color;
            users[socket.id].pfp = data.pfp; // Base64 or null
            io.emit('user-list', users);
        }
    });

    // Handle Messages
    socket.on('send-message', (data) => {
        const user = users[socket.id];
        if (!user || Date.now() < user.mutedUntil) return;

        const msgData = {
            id: Date.now() + Math.random().toString(16).slice(2),
            userId: socket.id,
            name: user.name,
            color: user.color,
            pfp: user.pfp,
            text: data.text,
            media: data.media, // { type: 'image'|'video', src: base64 }
            replyTo: data.replyTo,
            reactions: {},
            timestamp: Date.now()
        };

        messages.push(msgData);
        if (data.media) mediaGallery.push(data.media);
        
        io.emit('new-message', msgData);
    });

    // Typing Status
    socket.on('typing', (isTyping) => {
        socket.broadcast.emit('user-typing', { user: users[socket.id].name, isTyping: isTyping });
    });

    // Reactions
    socket.on('add-reaction', (data) => {
        io.emit('update-reaction', data); // Client handles UI update logic
    });

    // Vote Kick Logic
    socket.on('vote-kick', (targetId) => {
        if (!kickVotes[targetId]) kickVotes[targetId] = new Set();
        kickVotes[targetId].add(socket.id);

        const voteCount = kickVotes[targetId].size;
        const totalUsers = Object.keys(users).length;
        const required = Math.ceil(totalUsers * 0.66);

        // Notify chat of vote
        io.emit('system-alert', { 
            text: `VOTE KICK: ${users[targetId]?.name} (${voteCount}/${required} votes)` 
        });

        if (voteCount >= required) {
            io.to(targetId).emit('force-kick');
            io.emit('system-alert', { text: `${users[targetId]?.name} was kicked.` });
            delete users[targetId]; // Soft remove
            delete kickVotes[targetId];
        }
    });

    socket.on('disconnect', () => {
        delete users[socket.id];
        io.emit('user-count', Object.keys(users).length);
        io.emit('user-list', users);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`NEXUS active on port ${PORT}`));
