const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the "public" folder
app.use(express.static('public'));

let userCount = 0;
let wipeTimer = 900; // 15 minutes in seconds

// --- THE WIPE TIMER LOOP ---
setInterval(() => {
    wipeTimer--;
    
    // Send timer update to everyone every second
    io.emit('timer-update', wipeTimer);

    // When timer hits 0, wipe everything
    if (wipeTimer <= 0) {
        io.emit('force-wipe'); // Optional: triggers frontend clear
        io.emit('receive-msg', {
            msgId: 'sys-' + Date.now(),
            name: 'SYSTEM',
            color: '#ff4d4d',
            text: '⚠️ DATA WIPE COMPLETE. CHAT HISTORY CLEARED.',
            isSystem: true
        });
        wipeTimer = 900; // Reset to 15 mins
    }
}, 1000);

io.on('connection', (socket) => {
    userCount++;
    io.emit('user-count', userCount);

    // assign a temporary ID to the user for blocking logic
    socket.emit('assign-id', socket.id);

    console.log(`User connected: ${socket.id}`);

    // 1. HANDLE MESSAGES
    socket.on('send-msg', (data) => {
        // Broadcast the message to EVERYONE (including sender)
        io.emit('receive-msg', {
            userId: socket.id, // Used for blocking logic on frontend
            ...data
        });
    });

    // 2. HANDLE TYPING (New)
    socket.on('typing-start', (data) => {
        // Broadcast to everyone EXCEPT the person typing
        socket.broadcast.emit('typing-update', { isTyping: true, user: data.name });
    });

    socket.on('typing-stop', () => {
        // Broadcast to everyone EXCEPT the person typing
        socket.broadcast.emit('typing-update', { isTyping: false });
    });

    // 3. HANDLE REACTIONS (New)
    socket.on('add-reaction', (data) => {
        // Broadcast to EVERYONE (so the sender sees the count go up too)
        io.emit('update-reaction', data);
    });

    // 4. HANDLE DISCONNECT
    socket.on('disconnect', () => {
        userCount--;
        io.emit('user-count', userCount);
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`WIZs Server running on port ${PORT}`);
});
