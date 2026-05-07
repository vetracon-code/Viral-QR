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
    radiusMeters: 150,
    startedAt: null,
    endTime: null,
    active: false,
    users: {}
};

const OUTSIDE_GRACE_MS = 2 * 60 * 1000;

function distanceMeters(a, b) {
    if (!a || !b) return 0;

    const R = 6371000;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;

    const x = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) *
        Math.sin(dLng / 2) ** 2;

    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function evaluateUserArea(socket, user) {
    if (!gameState.active || !gameState.center || !gameState.radiusMeters || !user) return;

    const dist = distanceMeters(gameState.center, { lat: user.lat, lng: user.lng });
    const outside = dist > gameState.radiusMeters;

    user.distanceFromCenter = Math.round(dist);

    if (outside && !user.outsideArea) {
        user.outsideArea = true;
        user.outsideSince = Date.now();
        socket.emit('outsideAreaWarning', {
            graceSeconds: Math.round(OUTSIDE_GRACE_MS / 1000),
            distanceMeters: user.distanceFromCenter,
            radiusMeters: gameState.radiusMeters
        });
    }

    if (!outside && user.outsideArea) {
        user.outsideArea = false;
        user.outsideSince = null;
        socket.emit('backInsideArea');
    }
}

setInterval(() => {
    const now = Date.now();

    Object.values(gameState.users).forEach(user => {
        if (user.outsideArea && user.outsideSince && now - user.outsideSince > OUTSIDE_GRACE_MS) {
            const targetSocket = io.sockets.sockets.get(user.id);
            if (targetSocket) {
                targetSocket.emit('removedOutsideArea');
            }
            delete gameState.users[user.id];
        }
    });

    io.emit('updateMap', gameState.users);
}, 15000);

io.on('connection', (socket) => {
    socket.emit('sync', gameState);
    
    socket.on('adminStart', (data) => {
        let durationMs = data.unit === 'min' ? data.value * 60000 : data.value * 3600000;
        gameState.startedAt = Date.now();
        gameState.endTime = gameState.startedAt + durationMs;
        gameState.active = true;
        gameState.name = data.name;
        gameState.center = { lat: data.lat, lng: data.lng };
        gameState.radiusMeters = Math.max(20, Number(data.radiusMeters) || 150);
        io.emit('timerStarted', {
            startedAt: gameState.startedAt,
            endTime: gameState.endTime,
            name: data.name,
            center: gameState.center,
            radiusMeters: gameState.radiusMeters
        });
    });

    socket.on('registerUser', (userData) => {
        gameState.users[socket.id] = { 
            id: socket.id, 
            nick: userData.nick, 
            lat: userData.lat, 
            lng: userData.lng,
            outsideArea: false,
            outsideSince: null,
            distanceFromCenter: null,
            reactions: { '👍': 0, '❤️': 0, '🔥': 0, '🙌': 0, '😎': 0, '✨': 0 }
        };
        evaluateUserArea(socket, gameState.users[socket.id]);
        socket.emit('profileCreated', { id: socket.id, user: gameState.users[socket.id] });
        io.emit('updateMap', gameState.users);
    });

    socket.on('updatePosition', (pos) => {
        const user = gameState.users[socket.id];
        if (!user || !pos || typeof pos.lat !== 'number' || typeof pos.lng !== 'number') return;

        user.lat = pos.lat;
        user.lng = pos.lng;

        evaluateUserArea(socket, user);
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
        gameState.startedAt = null;
        gameState.endTime = null;
        gameState.center = null;
        gameState.radiusMeters = 150;
        gameState.name = "Viral Zone";
        io.emit('gameDeleted');
    });

    socket.on('disconnect', () => {
        delete gameState.users[socket.id];
        io.emit('updateMap', gameState.users);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Server Pronto'));
