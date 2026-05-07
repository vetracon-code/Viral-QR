const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let gameState = {
    endTime: null,
    active: false,
    users: {} // Struttura: { socketId: { nick, reactions: { '❤️': 0, '👍': 0, ... } } }
};

io.on('connection', (socket) => {
    socket.emit('sync', gameState);

    socket.on('adminStart', (data) => {
        let durationMs = 0;
        if (data.unit === 'min') durationMs = data.value * 60000;
        else if (data.unit === 'ore') durationMs = data.value * 3600000;
        else if (data.unit === 'giorni') durationMs = data.value * 86400000;
        gameState.endTime = Date.now() + durationMs;
        gameState.active = true;
        io.emit('timerStarted', gameState.endTime);
    });

    socket.on('registerUser', (userData) => {
        gameState.users[socket.id] = { 
            nick: userData.nick, 
            reactions: { '👍': 0, '❤️': 0, '🔥': 0, '🙌': 0, '😎': 0, '✨': 0 } 
        };
        socket.emit('profileCreated', { id: socket.id, user: gameState.users[socket.id] });
        io.emit('updateUsers', gameState.users);
    });

    socket.on('sendReaction', (data) => {
        // data = { toId: 'socket_id', icon: '❤️', fromNick: 'Pippo' }
        if (gameState.users[data.toId]) {
            gameState.users[data.toId].reactions[data.icon]++;
            io.emit('reactionUpdate', { 
                toId: data.toId, 
                reactions: gameState.users[data.toId].reactions,
                log: `${data.fromNick} ha inviato ${data.icon}`
            });
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Server Social pronto'));
