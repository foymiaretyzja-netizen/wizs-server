const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// INCREASED LIMIT: We set maxHttpBufferSize to 1e7 (10MB) 
// to handle video/GIF uploads smoothly.
const io = new Server(server, {
    maxHttpBufferSize: 1e7 
});

app.use(express.static(path.join(__dirname, 'public')));

let userCount = 0;
let timeLeft = 900; // 15 minutes

// Timer logic
setInterval(() => {
    timeLeft--;
    io.emit('timer-update', timeLeft);
    if (timeLeft <= 0) {
        timeLeft = 900;
        io.emit('room-reset');
    }
}, 1000);

io.on('connection', (socket) => {
    userCount++;
    const userId = socket.id; // Unique ID for blocking system
    
    io.emit('user-count', userCount);
    socket.emit('assign-id', userId);
    socket.emit('timer-update', timeLeft);

    // This handles EVERYTHING: text, images, videos, gifs, and msgIds
    socket.on('send-msg', (data) => {
        data.userId = userId; // Attach the hidden ID for the blocking system
        io.emit('receive-msg', data); 
    });

    socket.on('send-rating', (data) => {
        io.emit('receive-rating', data);
    });

    socket.on('disconnect', () => {
        userCount--;
        io.emit('user-count', userCount);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`WIZs Server running on port ${PORT}`);
});
