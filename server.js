const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let gameState = {
    endTime: null,
    active: false,
    users: {}
};

io.on('connection', (socket) => {
    socket.emit('sync', gameState);
    socket.on('adminStart', (data) => {
        const now = Date.now();
        let durationMs = 0;
        if (data.unit === 'min') durationMs = data.value * 60000;
        else if (data.unit === 'ore') durationMs = data.value * 3600000;
        else if (data.unit === 'giorni') durationMs = data.value * 86400000;
        gameState.endTime = now + durationMs;
        gameState.active = true;
        io.emit('timerStarted', gameState.endTime);
    });
    socket.on('registerUser', (userData) => {
        gameState.users[socket.id] = { nick: userData.nick, likes: 0 };
        socket.emit('profileCreated', { id: socket.id, nick: userData.nick });
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Server in ascolto'));
