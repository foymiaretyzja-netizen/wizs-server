const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8 // 100MB Upload Limit
});

// --- STATE MANAGEMENT ---
let users = {}; 
let messageHistory = [];
let activeVotes = {}; // Tracks ongoing vote kicks: { targetId: { initiator, votes: Set() } }
let bannedIPs = new Set(); // Server-side IP block list

// --- CONFIGURATION ---
const WIPE_INTERVAL = 900; // 15 Minutes
let wipeTimer = WIPE_INTERVAL;
let wipeIntervalID;

app.use(express.static(path.join(__dirname, 'public')));

// --- SYSTEM WIPE LOOP ---
function startWipeTimer() {
    clearInterval(wipeIntervalID);
    wipeTimer = WIPE_INTERVAL;
    
    wipeIntervalID = setInterval(() => {
        wipeTimer--;
        io.emit('timerUpdate', wipeTimer); // Sync timer with clients

        if (wipeTimer <= 0) {
            performSystemWipe();
        }
    }, 1000);
}

function performSystemWipe() {
    console.log("--- SYSTEM WIPE ---");
    users = {};
    messageHistory = [];
    activeVotes = {};
    bannedIPs.clear(); // Unban everyone after wipe
    io.emit('systemWipe'); // Tell clients to reset
    wipeTimer = WIPE_INTERVAL;
}

startWipeTimer();

// --- CONNECTION HANDLER ---
io.on('connection', (socket) => {
    const clientIP = socket.handshake.address;

    // 1. IP Ban Check
    if (bannedIPs.has(clientIP)) {
        console.log(`Blocked connection from banned IP: ${clientIP}`);
        socket.disconnect(true);
        return;
    }

    console.log(`User connected: ${socket.id}`);
    
    // 2. Initialize User
    users[socket.id] = {
        id: socket.id,
        username: `User-${socket.id.substr(0, 4)}`,
        tag: 'Guest',
        pfp: null,
        isAdmin: false,
        nameColor: 'default',
        lastMessageTime: 0
    };

    // 3. Sync State
    socket.emit('history', messageHistory);
    socket.emit('timerUpdate', wipeTimer);
    io.emit('userList', Object.values(users));

    // --- PROFILE UPDATES ---
    socket.on('updateProfile', (data) => {
        if(users[socket.id]) {
            users[socket.id] = { ...users[socket.id], ...data };
            io.emit('userList', Object.values(users));
        }
    });

    // --- CHAT MESSAGES ---
    socket.on('chatMessage', (msgData) => {
        const user = users[socket.id];
        if (!user) return;

        // Anti-Spam (500ms)
        const now = Date.now();
        if (now - user.lastMessageTime < 500) return;
        user.lastMessageTime = now;

        const fullMessage = {
            id: Date.now() + Math.random(),
            text: msgData.text,
            type: msgData.type || 'text',
            fileUrl: msgData.fileUrl || null,
            replyTo: msgData.replyTo || null,
            user: { ...user }, // Snapshot of user details
            timestamp: now,
            reactions: {}
        };

        messageHistory.push(fullMessage);
        if (messageHistory.length > 100) messageHistory.shift();
        io.emit('message', fullMessage);
    });

    // --- REACTIONS ---
    socket.on('react', ({ messageId, emoji }) => {
        const msg = messageHistory.find(m => m.id === messageId);
        if (msg) {
            if (!msg.reactions[emoji]) msg.reactions[emoji] = 0;
            msg.reactions[emoji]++;
            io.emit('updateReaction', { messageId, reactions: msg.reactions });
        }
    });

    // --- TYPING STATUS ---
    socket.on('typing', (isTyping) => {
        socket.broadcast.emit('typing', { username: users[socket.id].username, isTyping });
    });

    // ================================
    //      MODERATION & VOTING
    // ================================

    // 1. Start Stealth Vote Kick
    socket.on('startVoteKick', (targetId) => {
        if (!users[targetId] || activeVotes[targetId]) return;

        // Create Vote Instance
        activeVotes[targetId] = {
            initiator: socket.id,
            targetName: users[targetId].username,
            votes: new Set([socket.id]) // Initiator auto-votes yes
        };

        // Notify everyone EXCEPT the target (Stealth Mode)
        const targetSocket = io.sockets.sockets.get(targetId);
        socket.broadcast.emit('voteKickStarted', { 
            targetId, 
            targetName: users[targetId].username 
        });
        
        // If target exists, they don't get the event.
        // We manually send the event to the initiator to confirm start
        socket.emit('voteKickStarted', { 
            targetId, 
            targetName: users[targetId].username 
        });
    });

    // 2. Cast Vote
    socket.on('castVote', (targetId) => {
        if (!activeVotes[targetId]) return;

        activeVotes[targetId].votes.add(socket.id);
        const voteCount = activeVotes[targetId].votes.size;
        const totalUsers = Object.keys(users).length;
        
        // Check for Majority (51%)
        if (voteCount > totalUsers / 2) {
            const targetSocket = io.sockets.sockets.get(targetId);
            if (targetSocket) {
                targetSocket.disconnect(true); // "Black Screen" effect
                delete activeVotes[targetId];
                io.emit('adminAction', { type: 'kick', username: users[targetId]?.username });
                io.emit('systemAlert', { message: `${users[targetId]?.username} was voted off the island.` });
            }
        }
    });

    // 3. ADMIN: Direct Kick
    socket.on('adminKick', (targetId) => {
        // In real app, verify admin token here
        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) {
            targetSocket.disconnect(true);
            io.emit('adminAction', { type: 'kick', username: users[targetId]?.username });
        }
    });

    // 4. ADMIN: Ban (Kick + IP Block)
    socket.on('adminBan', (targetId) => {
        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) {
            const ip = targetSocket.handshake.address;
            bannedIPs.add(ip); // Add to blocklist
            targetSocket.disconnect(true); // Disconnect
            io.emit('adminAction', { type: 'ban', username: users[targetId]?.username });
        }
    });

    // 5. ADMIN: Warn
    socket.on('adminWarn', (data) => {
        io.emit('systemAlert', { message: `ADMIN: ${data.message}` });
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        // Remove active votes targeting this user
        if (activeVotes[socket.id]) delete activeVotes[socket.id];
        
        // Remove votes cast BY this user
        for (const targetId in activeVotes) {
            activeVotes[targetId].votes.delete(socket.id);
        }

        delete users[socket.id];
        io.emit('userList', Object.values(users));
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`NEXUS Server running on port ${PORT}`);
});
