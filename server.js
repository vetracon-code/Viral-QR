const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let gameState = {
    name: "Viral Zone",
    endTime: null,
    active: false,
    users: {}
};

function resetGame() {
    gameState.users = {};
    gameState.active = false;
    gameState.endTime = null;
    io.emit('gameDeleted');
}

io.on('connection', (socket) => {
    socket.emit('sync', gameState);
    socket.on('adminStart', (data) => {
        let durationMs = data.unit === 'min' ? data.value * 60000 : data.unit === 'ore' ? data.value * 3600000 : data.value * 86400000;
        gameState.endTime = Date.now() + durationMs;
        gameState.active = true;
        gameState.name = data.name;
        io.emit('timerStarted', { endTime: gameState.endTime, name: data.name });
        setTimeout(resetGame, durationMs);
    });
    socket.on('registerUser', (userData) => {
        gameState.users[socket.id] = { id: socket.id, nick: userData.nick || "Anonimo", lat: userData.lat, lng: userData.lng };
        socket.emit('profileCreated', { id: socket.id, user: gameState.users[socket.id] });
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Server Pronto'));
