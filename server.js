const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e7 
});

let timeLeft = 900; 
let timerStarted = false;
let onlineUsers = 0;

function startRoomTimer() {
    if (timerStarted) return;
    timerStarted = true;
    const interval = setInterval(() => {
        timeLeft--;
        io.emit('timer-update', timeLeft);
        if (timeLeft <= 0) {
            clearInterval(interval);
            timeLeft = 900; timerStarted = false;
            io.emit('room-reset');
        }
    }, 1000);
}

io.on('connection', (socket) => {
    onlineUsers++;
    const userId = "ID-" + Math.random().toString(36).substring(2, 7);
    
    startRoomTimer();
    io.emit('user-count', onlineUsers);
    socket.emit('assign-id', userId);

    socket.on('send-msg', (data) => {
        data.userId = userId; // Attach the hidden ID
        io.emit('receive-msg', data);
    });

    socket.on('disconnect', () => {
        onlineUsers--;
        io.emit('user-count', onlineUsers);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
