const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- TIMER LOGIC ---
let timeLeft = 900; 
let timerStarted = false;

function startRoomTimer() {
    if (timerStarted) return;
    timerStarted = true;
    const interval = setInterval(() => {
        timeLeft--;
        io.emit('timer-update', timeLeft);
        if (timeLeft <= 0) {
            clearInterval(interval);
            timeLeft = 900;
            timerStarted = false;
            io.emit('room-reset'); // Tells everyone to lock up
        }
    }, 1000);
}

io.on('connection', (socket) => {
    startRoomTimer(); 
    socket.emit('timer-update', timeLeft);

    socket.on('send-msg', (data) => {
        io.emit('receive-msg', data);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
