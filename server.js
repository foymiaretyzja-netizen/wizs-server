const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 }); // 100MB limit

app.use(express.static(path.join(__dirname, 'public')));

// --- STATE ---
let users = {};
let bannedIPs = {}; 
let activeVotes = {};
let messageReactions = {}; 
let globalTimer = 900; // 15 Minutes

// --- 15 MINUTE WIPE TIMER ---
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

// --- ACTIVITY MONITOR (20s Timeout) ---
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
}, 5000); // Check every 5 seconds

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
            tagColor: userData.tagColor || 'white', // New Tag Color
            pfp: userData.pfp || null, 
            ip: userIP,
            active: true,
            lastActive: Date.now()
        };
        io.emit('user-update', Object.values(users));
    });

    socket.on('update-profile', (data) => {
        if (users[socket.id]) {
            users[socket.id].name = data.name || users[socket.id].name;
            users[socket.id].tag = data.tag || "";
            users[socket.id].color = data.color || "white";
            users[socket.id].tagColor = data.tagColor || "white"; // Update Tag Color
            if (data.pfp !== undefined) users[socket.id].pfp = data.pfp;
            io.emit('user-update', Object.values(users));
        }
    });

    socket.on('activity-ping', () => {
        if (users[socket.id]) {
            users[socket.id].lastActive = Date.now();
            if (!users[socket.id].active) {
                users[socket.id].active = true;
                io.emit('user-update', Object.values(users));
            }
        }
    });

    // --- TYPING STATUS ---
    socket.on('typing', (isTyping) => {
        const user = users[socket.id];
        if (user) {
            socket.broadcast.emit('user-typing', { 
                name: user.name, 
                isTyping: isTyping 
            });
        }
    });

    socket.on('send-message', (data) => {
        const user = users[socket.id];
        if (!user) return;

        // Update activity
        user.lastActive = Date.now();
        user.active = true;

        // Anti-Spam: 500ms hard limit
        const now = Date.now();
        if (user.lastMsgTime && now - user.lastMsgTime < 500) return; 
        user.lastMsgTime = now;

        const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        messageReactions[msgId] = {}; 

        io.emit('receive-message', {
            id: msgId,
            userId: socket.id,
            name: user.name,
            color: user.color,
            tag: user.tag,
            tagColor: user.tagColor, // Send Tag Color
            pfp: user.pfp,
            text: data.text,
            media: data.media,
            mediaType: data.mediaType,
            replyTo: data.replyTo,
            timestamp: Date.now()
        });
    });

    socket.on('add-reaction', (data) => {
        if (!messageReactions[data.msgId]) return;
        if (!messageReactions[data.msgId][data.emoji]) messageReactions[data.msgId][data.emoji] = 0;
        messageReactions[data.msgId][data.emoji]++;
        
        io.emit('update-reaction', { 
            msgId: data.msgId, 
            reactions: messageReactions[data.msgId] 
        });
    });

    // --- VOTE KICK ---
    socket.on('report-user', (targetId) => {
        if (!users[targetId] || activeVotes[targetId]) return;
        
        activeVotes[targetId] = { yes: 1, no: 0, voters: [socket.id], target: targetId };
        
        // Broadcast vote start
        io.emit('vote-kick-start', { 
            targetId: targetId, 
            targetName: users[targetId].name 
        });
    });

    socket.on('cast-vote', (data) => {
        const voteSession = activeVotes[data.targetId];
        if (!voteSession || voteSession.voters.includes(socket.id)) return;
        voteSession.voters.push(socket.id);
        
        if (data.vote === 'yes') voteSession.yes++;
        else voteSession.no++;

        const onlineCount = Object.keys(users).length;
        const required = Math.ceil(onlineCount * 0.51); 

        if (voteSession.yes >= required) {
            const targetSocket = io.sockets.sockets.get(data.targetId);
            if (targetSocket) {
                targetSocket.emit('force-disconnect', { reason: 'KICKED' });
                targetSocket.disconnect();
            }
            delete activeVotes[data.targetId];
            io.emit('vote-result', { targetId: data.targetId, result: 'kicked', name: users[data.targetId]?.name || 'User' });
        }
    });

    socket.on('disconnect', () => {
        delete users[socket.id];
        io.emit('user-update', Object.values(users));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`NEXUS Online on port ${PORT}`));
