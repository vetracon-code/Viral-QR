const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const randomNicks = ["EcoFantasma", "StellaRandagia", "LampoNascosto", "VentoLibero", "NebbiaArgentea", "ScattoRapido", "OrizzonteBlu", "MisteroPuro"];

let gameState = {
    endTime: null,
    active: false,
    users: {}
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
        let finalNick = userData.nick.trim();
        if (!finalNick) {
            finalNick = randomNicks[Math.floor(Math.random() * randomNicks.length)] + Math.floor(Math.random() * 100);
        }
        
        gameState.users[socket.id] = { 
            id: socket.id,
            nick: finalNick, 
            reactions: { '👍': 0, '❤️': 0, '🔥': 0, '🙌': 0, '😎': 0, '✨': 0 } 
        };
        socket.emit('profileCreated', { id: socket.id, user: gameState.users[socket.id] });
    });

    socket.on('sendReaction', (data) => {
        // data: { toId, icon, fromId, fromNick }
        if (gameState.users[data.toId]) {
            gameState.users[data.toId].reactions[data.icon]++;
            // Invia la notifica specifica al destinatario per permettergli di ricambiare
            io.to(data.toId).emit('receiveNotification', {
                fromId: data.fromId,
                fromNick: data.fromNick,
                icon: data.icon
            });
            // Aggiorna i contatori globali per il destinatario
            io.to(data.toId).emit('updateMyReactions', gameState.users[data.toId].reactions);
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Server con Ricambia pronto'));
