const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let gameState = {
    name: "Viral Zone",
    center: null,
    endTime: null,
    active: false,
    users: {}
};

io.on('connection', (socket) => {
    socket.emit('sync', gameState);
    
    socket.on('adminStart', (data) => {
        let durationMs = data.unit === 'min' ? data.value * 60000 : data.value * 3600000;
        gameState.endTime = Date.now() + durationMs;
        gameState.active = true;
        gameState.name = data.name;
        gameState.center = { lat: data.lat, lng: data.lng };
        io.emit('timerStarted', { endTime: gameState.endTime, name: data.name, center: gameState.center });
    });

    socket.on('registerUser', (userData) => {
        gameState.users[socket.id] = { 
            id: socket.id, 
            nick: userData.nick, 
            lat: userData.lat, 
            lng: userData.lng,
            reactions: { '👍': 0, '❤️': 0, '🔥': 0, '🙌': 0, '😎': 0, '✨': 0 }
        };
        socket.emit('profileCreated', { id: socket.id, user: gameState.users[socket.id] });
        io.emit('updateMap', gameState.users);
    });

    socket.on('sendLike', (data) => {
        const targetId = data && data.to;
        const fromId = data && data.from;
        const type = data && data.type;

        if (!targetId || !fromId || !type) return;

        const sender = gameState.users[fromId];
        const targetSocket = io.sockets.sockets.get(targetId);

        if (!sender || !targetSocket) {
            socket.emit('interactionError', { message: 'Utente non più disponibile.' });
            return;
        }

        targetSocket.emit('receiveLike', {
            from: fromId,
            fromNick: sender.nick || 'Anonimo',
            type
        });
    });

    socket.on('adminRequestReset', () => {
        gameState.users = {};
        gameState.active = false;
        gameState.endTime = null;
        io.emit('gameDeleted');
    });

    socket.on('disconnect', () => {
        delete gameState.users[socket.id];
        io.emit('updateMap', gameState.users);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Server Pronto'));
