const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 }); // 100MB limit

app.use(express.static(path.join(__dirname, 'public')));

// STATE
let users = {};
let bannedIPs = {}; 
let activeVotes = {};
let messageReactions = {}; // { msgId: { '❤️': 2, '😂': 1 } }
let globalTimer = 900; 

// TIMER & WIPE
setInterval(() => {
    globalTimer--;
    io.emit('timer-update', globalTimer);
    
    if (globalTimer <= 0) {
        users = {};
        activeVotes = {};
        messageReactions = {};
        io.emit('system-wipe');
        globalTimer = 900;
        console.log("SYSTEM WIPE COMPLETE");
    }
}, 1000);

io.on('connection', (socket) => {
    const userIP = socket.handshake.address;

    if (bannedIPs[userIP] && bannedIPs[userIP] > Date.now()) {
        socket.emit('force-disconnect', { reason: 'BAN', time: bannedIPs[userIP] });
        socket.disconnect();
        return;
    }

    socket.on('join-nexus', (userData) => {
        users[socket.id] = {
            id: socket.id,
            name: userData.name || 'User',
            color: userData.color || 'white',
            tag: userData.tag || '',
            pfp: userData.pfp || null, // Base64 string
            ip: userIP,
            warnings: 0,
            active: true
        };
        io.emit('user-update', Object.values(users));
        
        if (Object.keys(users).length === 1) socket.emit('alone-notice', true);
    });

    // UPDATE SETTINGS
    socket.on('update-profile', (data) => {
        if (users[socket.id]) {
            users[socket.id].name = data.name || users[socket.id].name;
            users[socket.id].tag = data.tag || users[socket.id].tag;
            users[socket.id].color = data.color || users[socket.id].color;
            users[socket.id].pfp = data.pfp; // Can be null or base64
            io.emit('user-update', Object.values(users));
        }
    });

    socket.on('activity-ping', () => {
        if (users[socket.id]) users[socket.id].active = true;
    });

    socket.on('send-message', (data) => {
        const user = users[socket.id];
        if (!user) return;

        // SPAM CHECK (Simplified)
        const now = Date.now();
        if (user.lastMsgTime && now - user.lastMsgTime < 500) return; // Hard 500ms limit
        user.lastMsgTime = now;

        const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        messageReactions[msgId] = {}; // Init reactions

        io.emit('receive-message', {
            id: msgId,
            userId: socket.id,
            name: user.name,
            color: user.color,
            tag: user.tag,
            pfp: user.pfp,
            text: data.text,
            media: data.media,
            mediaType: data.mediaType,
            replyTo: data.replyTo,
            timestamp: Date.now()
        });
    });

    // REACTIONS
    socket.on('add-reaction', (data) => {
        // data: { msgId, emoji }
        if (!messageReactions[data.msgId]) return;
        
        if (!messageReactions[data.msgId][data.emoji]) {
            messageReactions[data.msgId][data.emoji] = 0;
        }
        messageReactions[data.msgId][data.emoji]++;
        
        io.emit('update-reaction', { 
            msgId: data.msgId, 
            reactions: messageReactions[data.msgId] 
        });
    });

    socket.on('report-user', (targetId) => {
        if (!users[targetId] || activeVotes[targetId]) return;
        activeVotes[targetId] = { yes: 1, no: 0, voters: [socket.id], target: targetId };
        socket.broadcast.emit('vote-kick-start', { targetId: targetId, name: users[targetId].name });
    });

    socket.on('cast-vote', (data) => {
        const voteSession = activeVotes[data.targetId];
        if (!voteSession || voteSession.voters.includes(socket.id)) return;
        voteSession.voters.push(socket.id);
        
        if (data.vote === 'yes') voteSession.yes++;
        else voteSession.no++;

        const onlineCount = Object.keys(users).length;
        const required = Math.ceil(onlineCount * 0.66);

        if (voteSession.yes >= required) {
            const targetSocket = io.sockets.sockets.get(data.targetId);
            if (targetSocket) {
                targetSocket.emit('force-disconnect', { reason: 'KICKED BY VOTE' });
                targetSocket.disconnect();
            }
            delete activeVotes[data.targetId];
            io.emit('vote-result', { targetId: data.targetId, result: 'kicked' });
        }
    });

    socket.on('disconnect', () => {
        delete users[socket.id];
        io.emit('user-update', Object.values(users));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`NEXUS Online on port ${PORT}`));
