const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());

// Serve the index.html file when someone visits the site
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Chat Logic
io.on('connection', (socket) => {
    console.log('A user connected: ' + socket.id);

    socket.on('send-msg', (data) => {
        // Broadcast the message to everyone connected
        io.emit('receive-msg', data);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
