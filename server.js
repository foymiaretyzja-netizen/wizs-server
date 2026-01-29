const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allows your Neocities/Render site to connect
        methods: ["GET", "POST"]
    }
});

// The "Brain" of the chat
io.on('connection', (socket) => {
    console.log('A user connected');

    // When someone sends a message, "shout" it to everyone else
    socket.on('send-msg', (data) => {
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
