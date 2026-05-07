const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// Il cuore del gioco: vive solo nella RAM, non viene scritto su disco
let gameState = {
    name: "Viral Zone",
    endTime: null,
    active: false,
    users: {}
};

function resetGame() {
    console.log("Timer scaduto: Cancellazione totale dati in corso...");
    gameState.users = {};
    gameState.active = false;
    gameState.endTime = null;
    io.emit('gameDeleted', { message: "Dati eliminati per la tua privacy." });
}

io.on('connection', (socket) => {
    socket.emit('sync', gameState);

    socket.on('adminStart', (data) => {
        let durationMs = data.unit === 'min' ? data.value * 60000 : data.value * 3600000;
        gameState.endTime = Date.now() + durationMs;
        gameState.active = true;
        io.emit('timerStarted', { endTime: gameState.endTime, name: data.name });

        // Imposta il "timer di autodistruzione"
        setTimeout(() => {
            resetGame();
        }, durationMs);
    });

    socket.on('registerUser', (userData) => {
        if (!gameState.active) return;
        gameState.users[socket.id] = { 
            id: socket.id,
            nick: userData.nick || "Anonimo" + Math.floor(Math.random()*100),
            lat: userData.lat,
            lng: userData.lng,
            reactions: { '👍': 0, '❤️': 0, '🔥': 0, '🙌': 0, '😎': 0, '✨': 0 }
        };
        socket.emit('profileCreated', { id: socket.id, user: gameState.users[socket.id] });
        io.emit('updateMap', gameState.users);
    });

    socket.on('disconnect', () => {
        // Rimuove l'utente se chiude la pagina (opzionale, ma aumenta la privacy)
        delete gameState.users[socket.id];
        io.emit('updateMap', gameState.users);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Server Privacy-First Pronto'));
