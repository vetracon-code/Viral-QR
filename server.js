const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let globalEndTime = null; 
let players = []; 

io.on('connection', (socket) => {
    socket.emit('init', { players, globalEndTime });

    socket.on('createMaster', (durationMinutes) => {
        if (!globalEndTime) {
            globalEndTime = Date.now() + (durationMinutes * 60000);
            io.emit('timerStarted', globalEndTime);
        }
    });

    socket.on('joinGame', (userData) => {
        const newUser = { ...userData, id: socket.id, likes: 0 };
        players.push(newUser);
        io.emit('newPlayer', newUser); 
    });

    socket.on('sendLike', (targetId) => {
        const player = players.find(p => p.id === targetId);
        if (player) {
            player.likes++;
            io.emit('updateLikes', { id: targetId, likes: player.likes });
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));