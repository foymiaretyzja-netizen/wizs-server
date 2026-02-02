const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

app.use(express.static(path.join(__dirname, 'public')));

// --- STATE ---
let users = {};
let activeVotes = {};
let messageReactions = {}; 
let globalTimer = 900; // 15 Min

// --- TIMER LOOP ---
setInterval(() => {
    globalTimer--;
    io.emit('timer-update', globalTimer);
    if (globalTimer <= 0) {
        users = {}; activeVotes = {}; messageReactions = {};
        io.emit('system-wipe');
        globalTimer = 900;
    }
}, 1000);

// --- ACTIVITY LOOP (20s Timeout) ---
setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (let id in users) {
        if (users[id].active && (now - users[id].lastActive > 20000)) {
            users[id].active = false;
            changed = true;
        }
    }
    if (changed) io.emit('user-update', Object.values(users));
}, 5000);

io.on('connection', (socket) => {
    // --- JOIN ---
    socket.on('join-nexus', (userData) => {
        users[socket.id] = {
            id: socket.id,
            name: userData.name || 'User',
            tag: userData.tag || '',
            tagColor: userData.tagColor || 'white',
            color: userData.color || 'white',
            pfp: userData.pfp || null,
            active: true,
            lastActive: Date.now()
        };
        io.emit('user-update', Object.values(users));
    });

    // --- PROFILE UPDATES ---
    socket.on('update-profile', (data) => {
        if (users[socket.id]) {
            users[socket.id].name = data.name || users[socket.id].name;
            users[socket.id].tag = data.tag || "";
            users[socket.id].tagColor = data.tagColor || "white";
            users[socket.id].color = data.color || "white";
            if (data.pfp !== undefined) users[socket.id].pfp = data.pfp;
            io.emit('user-update', Object.values(users));
        }
    });

    // --- ACTIVITY PING ---
    socket.on('activity-ping', () => {
        if (users[socket.id]) {
            users[socket.id].lastActive = Date.now();
            if (!users[socket.id].active) {
                users[socket.id].active = true;
                io.emit('user-update', Object.values(users));
            }
        }
    });

    // --- MESSAGING ---
    socket.on('typing', (isTyping) => socket.broadcast.emit('user-typing', { name: users[socket.id]?.name, isTyping }));

    socket.on('send-message', (data) => {
        const user = users[socket.id];
        if (!user) return;
        user.lastActive = Date.now(); user.active = true;
        
        const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        messageReactions[msgId] = {}; 

        io.emit('receive-message', {
            id: msgId, userId: socket.id,
            name: user.name, color: user.color,
            tag: user.tag, tagColor: user.tagColor,
            pfp: user.pfp,
            text: data.text, media: data.media, mediaType: data.mediaType,
            replyTo: data.replyTo, timestamp: Date.now()
        });
    });

    socket.on('add-reaction', (data) => {
        if(!messageReactions[data.msgId]) return;
        if(!messageReactions[data.msgId][data.emoji]) messageReactions[data.msgId][data.emoji] = 0;
        messageReactions[data.msgId][data.emoji]++;
        io.emit('update-reaction', { msgId: data.msgId, reactions: messageReactions[data.msgId] });
    });

    // --- VOTE KICK ---
    socket.on('report-user', (targetId) => {
        if (!users[targetId] || activeVotes[targetId]) return;
        activeVotes[targetId] = { yes: 1, no: 0, voters: [socket.id], target: targetId };
        io.emit('vote-kick-start', { targetId: targetId, targetName: users[targetId].name });
    });

    socket.on('cast-vote', (data) => {
        const session = activeVotes[data.targetId];
        if (!session || session.voters.includes(socket.id)) return;
        session.voters.push(socket.id);
        
        if (data.vote === 'yes') session.yes++; else session.no++;

        const required = Math.ceil(Object.keys(users).length * 0.51); 
        if (session.yes >= required) {
            const targetSocket = io.sockets.sockets.get(data.targetId);
            if (targetSocket) {
                targetSocket.emit('force-disconnect', { reason: 'KICKED_BY_VOTE' });
                targetSocket.disconnect();
            }
            delete activeVotes[data.targetId];
            io.emit('vote-result', { targetId: data.targetId, result: 'kicked', name: users[data.targetId]?.name });
        }
    });

    socket.on('disconnect', () => {
        delete users[socket.id];
        io.emit('user-update', Object.values(users));
    });
});

server.listen(3000, () => console.log(`NEXUS Online port 3000`));
