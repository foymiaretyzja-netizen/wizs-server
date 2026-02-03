const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 1e8 // 100MB upload limit
});

app.use(express.static(path.join(__dirname, 'public')));

// --- GLOBAL STATE ---
let users = {};
let bannedIPs = {}; 
let activeVotes = {};     // Tracks ongoing vote kicks
let messageReactions = {}; 
let globalTimer = 900;    // 15 Minutes in seconds

// --- 1. THE 15-MINUTE SYSTEM WIPE ---
setInterval(() => {
    globalTimer--;
    io.emit('timer-update', globalTimer);
    
    if (globalTimer <= 0) {
        // RESET EVERYTHING
        users = {};
        activeVotes = {};
        messageReactions = {};
        io.emit('system-wipe');
        
        // Reset Timer
        globalTimer = 900;
        console.log("--- SYSTEM WIPE COMPLETE ---");
    }
}, 1000);

// --- 2. ACTIVITY MONITOR (IDLE CHECK) ---
// Checks every 5 seconds. If user hasn't acted in 20s, mark as Idle.
setInterval(() => {
    const now = Date.now();
    let hasChanged = false;

    for (let id in users) {
        if (users[id].active) {
            // 20 Seconds Timeout
            if (now - users[id].lastActive > 20000) {
                users[id].active = false;
                hasChanged = true;
            }
        }
    }

    if (hasChanged) {
        io.emit('user-update', Object.values(users));
    }
}, 5000);

// --- SOCKET CONNECTION HANDLER ---
io.on('connection', (socket) => {
    const userIP = socket.handshake.address;

    // Check IP Ban
    if (bannedIPs[userIP] && bannedIPs[userIP] > Date.now()) {
        socket.emit('force-disconnect', { reason: 'IP_BANNED' });
        socket.disconnect();
        return;
    }

    console.log(`User Connected: ${socket.id}`);

    // --- JOIN EVENT ---
    socket.on('join-nexus', (userData) => {
        users[socket.id] = {
            id: socket.id,
            name: userData.name || 'Anonymous',
            tag: userData.tag || '',
            tagColor: userData.tagColor || 'white',
            color: userData.color || 'white',
            pfp: userData.pfp || null,
            ip: userIP,
            active: true,
            lastActive: Date.now(),
            lastMsgTime: 0
        };

        // Broadcast new user list to everyone
        io.emit('user-update', Object.values(users));
    });

    // --- UPDATE PROFILE (Live Settings) ---
    socket.on('update-profile', (data) => {
        if (users[socket.id]) {
            users[socket.id].name = data.name || users[socket.id].name;
            users[socket.id].tag = data.tag || "";
            users[socket.id].tagColor = data.tagColor || "white";
            users[socket.id].color = data.color || "white";
            
            if (data.pfp !== undefined) {
                users[socket.id].pfp = data.pfp;
            }
            
            users[socket.id].lastActive = Date.now();
            users[socket.id].active = true;
            
            io.emit('user-update', Object.values(users));
        }
    });

    // --- ACTIVITY PING ---
    // Client sends this on mousemove/keypress to stay "Active"
    socket.on('activity-ping', () => {
        if (users[socket.id]) {
            users[socket.id].lastActive = Date.now();
            
            // If they were idle, mark them active again and update everyone
            if (!users[socket.id].active) {
                users[socket.id].active = true;
                io.emit('user-update', Object.values(users));
            }
        }
    });

    // --- TYPING INDICATOR ---
    socket.on('typing', (isTyping) => {
        const user = users[socket.id];
        if (user) {
            socket.broadcast.emit('user-typing', { 
                name: user.name, 
                isTyping: isTyping 
            });
        }
    });

    // --- MESSAGE HANDLING ---
    socket.on('send-message', (data) => {
        const user = users[socket.id];
        if (!user) return;

        // Reset Activity
        user.lastActive = Date.now();
        user.active = true;

        // Anti-Spam (500ms)
        const now = Date.now();
        if (user.lastMsgTime && now - user.lastMsgTime < 500) {
            return; // Ignore spam
        }
        user.lastMsgTime = now;

        // Create Message Object
        const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        messageReactions[msgId] = {}; 

        const messageData = {
            id: msgId,
            userId: socket.id,
            name: user.name,
            color: user.color,
            tag: user.tag,
            tagColor: user.tagColor,
            pfp: user.pfp,
            text: data.text,
            media: data.media,
            mediaType: data.mediaType,
            replyTo: data.replyTo,
            timestamp: Date.now()
        };

        io.emit('receive-message', messageData);
    });

    // --- REACTIONS ---
    socket.on('add-reaction', (data) => {
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

    // --- VOTE KICK SYSTEM ---
    socket.on('report-user', (targetId) => {
        // Prevent abuse: cannot vote if target invalid or vote already active
        if (!users[targetId] || activeVotes[targetId]) return;
        
        activeVotes[targetId] = { 
            yes: 1, 
            no: 0, 
            voters: [socket.id], 
            target: targetId 
        };
        
        console.log(`Vote started against ${users[targetId].name}`);

        // Notify Clients (Client hides this if targetId == their ID)
        io.emit('vote-kick-start', { 
            targetId: targetId, 
            targetName: users[targetId].name 
        });
    });

    socket.on('cast-vote', (data) => {
        const voteSession = activeVotes[data.targetId];
        
        // Validation: Vote exists? User already voted?
        if (!voteSession || voteSession.voters.includes(socket.id)) return;
        
        voteSession.voters.push(socket.id);
        
        if (data.vote === 'yes') voteSession.yes++;
        else voteSession.no++;

        // Calculate Majority (51%)
        const onlineCount = Object.keys(users).length;
        const required = Math.ceil(onlineCount * 0.51); 

        if (voteSession.yes >= required) {
            const targetSocket = io.sockets.sockets.get(data.targetId);
            
            // KICK THE USER
            if (targetSocket) {
                targetSocket.emit('force-disconnect', { reason: 'KICKED_BY_VOTE' });
                targetSocket.disconnect();
            }
            
            // End Vote
            delete activeVotes[data.targetId];
            io.emit('vote-result', { 
                targetId: data.targetId, 
                result: 'kicked', 
                name: users[data.targetId]?.name || 'User' 
            });
        }
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        if (users[socket.id]) {
            console.log(`User Left: ${users[socket.id].name}`);
            delete users[socket.id];
            io.emit('user-update', Object.values(users));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`NEXUS Online on port ${PORT}`));
