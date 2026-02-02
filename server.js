const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 }); // 100MB limit for media

app.use(express.static(path.join(__dirname, 'public')));

// STATE
let users = {};
let bannedIPs = {}; // Simple memory ban (wipes on server restart or manually)
let activeVotes = {}; // targetId: { yes: 0, no: 0, voters: [] }
let globalTimer = 900; // 15 minutes in seconds

// 15 MINUTE WIPE TIMER
setInterval(() => {
    globalTimer--;
    io.emit('timer-update', globalTimer);
    
    if (globalTimer <= 0) {
        // WIPE EVERYTHING
        users = {};
        activeVotes = {};
        io.emit('system-wipe');
        globalTimer = 900;
        console.log("SYSTEM WIPE COMPLETE");
    }
}, 1000);

io.on('connection', (socket) => {
    const userIP = socket.handshake.address;

    // CHECK BAN
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
            ip: userIP,
            warnings: 0,
            lastMsgTime: 0,
            msgCount: 0,
            active: true
        };
        io.emit('user-update', Object.values(users));
        
        // Notify if alone
        if (Object.keys(users).length === 1) {
            socket.emit('alone-notice', true);
        }
    });

    socket.on('activity-ping', () => {
        if (users[socket.id]) users[socket.id].active = true;
    });

    socket.on('send-message', (data) => {
        const user = users[socket.id];
        if (!user) return;

        // SPAM PROTECTION (6 msgs in 10s)
        const now = Date.now();
        if (now - user.lastMsgTime < 10000) {
            user.msgCount++;
        } else {
            user.msgCount = 1;
            user.lastMsgTime = now;
        }

        if (user.msgCount > 7) {
            user.warnings++;
            socket.emit('spam-warning', user.warnings);
            if (user.warnings >= 5) {
                // MUTE (Client side disable handled, server ignores)
                socket.emit('muted', 60000); 
            }
            return;
        }

        // Broadcast
        io.emit('receive-message', {
            id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            userId: socket.id,
            name: user.name,
            color: user.color,
            tag: user.tag,
            text: data.text,
            media: data.media, // Base64
            mediaType: data.mediaType,
            replyTo: data.replyTo,
            timestamp: Date.now()
        });
    });

    socket.on('add-reaction', (data) => {
        io.emit('update-reaction', data); // { msgId, emoji }
    });

    socket.on('report-user', (targetId) => {
        if (!users[targetId] || activeVotes[targetId]) return;
        
        activeVotes[targetId] = { yes: 1, no: 0, voters: [socket.id], target: targetId };
        
        // Notify everyone except target
        socket.broadcast.emit('vote-kick-start', { 
            targetId: targetId, 
            name: users[targetId].name 
        });
    });

    socket.on('cast-vote', (data) => {
        // data: { targetId, vote: 'yes' | 'no' }
        const voteSession = activeVotes[data.targetId];
        if (!voteSession || voteSession.voters.includes(socket.id)) return;

        voteSession.voters.push(socket.id);
        if (data.vote === 'yes') voteSession.yes++;
        else voteSession.no++;

        // CHECK THRESHOLD (2/3 majority of online users)
        const onlineCount = Object.keys(users).length;
        const required = Math.ceil(onlineCount * 0.66);

        if (voteSession.yes >= required) {
            // KICK
            const targetSocket = io.sockets.sockets.get(data.targetId);
            if (targetSocket) {
                // Add warnings/ban logic
                const tUser = users[data.targetId];
                if (tUser) {
                    tUser.warnings += 2; // Kicking adds warnings
                    if (tUser.warnings >= 5) {
                        bannedIPs[tUser.ip] = Date.now() + (30 * 60000); // 30 min ban
                    }
                    targetSocket.emit('force-disconnect', { reason: 'KICK' });
                    targetSocket.disconnect();
                }
            }
            delete activeVotes[data.targetId];
            io.emit('vote-result', { targetId: data.targetId, result: 'kicked' });
        } else if (voteSession.no > (onlineCount - required)) {
            // Vote Failed
             delete activeVotes[data.targetId];
             io.emit('vote-result', { targetId: data.targetId, result: 'failed' });
        }
    });

    socket.on('disconnect', () => {
        delete users[socket.id];
        io.emit('user-update', Object.values(users));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`NEXUS Online on port ${PORT}`));
