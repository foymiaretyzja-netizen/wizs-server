const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 1. KEEP 10MB LIMIT (From your original code)
const io = new Server(server, { 
    maxHttpBufferSize: 1e7 
});

// 2. SERVE FROM ROOT FOLDER (Fixes "Cannot GET /" error)
app.use(express.static(__dirname));

let userCount = 0;
let timeLeft = 900; // 15 minutes

// --- TIMER LOGIC ---
setInterval(() => {
    timeLeft--;
    
    // Sync timer with everyone
    io.emit('timer-update', timeLeft);

    // Reset when time is up
    if (timeLeft <= 0) {
        timeLeft = 900;
        io.emit('force-wipe'); // Triggers frontend clear
        io.emit('receive-msg', {
            msgId: 'sys-' + Date.now(),
            name: 'SYSTEM',
            color: '#ff4d4d',
            text: '⚠️ DATA WIPE COMPLETE.',
            isSystem: true
        });
    }
}, 1000);

io.on('connection', (socket) => {
    userCount++;
    const userId = socket.id;

    // Send initial data to the new user
    io.emit('user-count', userCount);
    socket.emit('assign-id', userId);
    socket.emit('timer-update', timeLeft);

    console.log(`User connected: ${userId}`);

    // --- MESSAGING ---
    socket.on('send-msg', (data) => {
        data.userId = userId; // Attach ID for blocking
        io.emit('receive-msg', data);
    });

    // --- NEW: TYPING INDICATORS ---
    socket.on('typing-start', (data) => {
        // Send to everyone EXCEPT sender
        socket.broadcast.emit('typing-update', { isTyping: true, user: data.name });
    });

    socket.on('typing-stop', () => {
        socket.broadcast.emit('typing-update', { isTyping: false });
    });

    // --- NEW: REACTIONS ---
    socket.on('add-reaction', (data) => {
        io.emit('update-reaction', data);
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        userCount--;
        io.emit('user-count', userCount);
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`WIZs Server running on http://localhost:${PORT}`);
});
