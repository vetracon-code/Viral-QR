const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let gameState = {
    name: "Viral Zone Milano",
    startTime: null,
    endTime: null,
    active: false,
    center: { lat: 45.4642, lng: 9.1900 }, // Default: Milano
    radius: 500, // metri
    users: {}
};

io.on('connection', (socket) => {
    socket.emit('sync', gameState);

    socket.on('adminStart', (data) => {
        gameState.name = data.name || "Evento Live";
        let durationMs = data.unit === 'min' ? data.value * 60000 : data.value * 3600000;
        gameState.endTime = Date.now() + durationMs;
        gameState.active = true;
        io.emit('timerStarted', { endTime: gameState.endTime, name: gameState.name });
    });

    socket.on('registerUser', (userData) => {
        gameState.users[socket.id] = { 
            id: socket.id,
            nick: userData.nick || "User" + Math.floor(Math.random()*100),
            lat: userData.lat,
            lng: userData.lng,
            reactions: { '👍': 0, '❤️': 0, '🔥': 0, '🙌': 0, '😎': 0, '✨': 0 }
        };
        socket.emit('profileCreated', { id: socket.id, user: gameState.users[socket.id] });
        io.emit('updateMap', gameState.users);
    });

    socket.on('updateLocation', (coords) => {
        if (gameState.users[socket.id]) {
            gameState.users[socket.id].lat = coords.lat;
            gameState.users[socket.id].lng = coords.lng;
            io.emit('updateMap', gameState.users);
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Server Mappa Pronto'));
