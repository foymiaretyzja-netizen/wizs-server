const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Keep the 10MB limit so your new GIF/Video features don't crash
const io = new Server(server, {
    maxHttpBufferSize: 1e7 
});

// This line tells the server to look in the CURRENT folder for index.html
app.use(express.static(__dirname));

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
    const userId = socket.id;
    
    io.emit('user-count', userCount);
    socket.emit('assign-id', userId);
    socket.emit('timer-update', timeLeft);

    socket.on('send-msg', (data) => {
        data.userId = userId; // Keep this for the blocking system to work
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
    console.log(`WIZs Server running on http://localhost:${PORT}`);
});
