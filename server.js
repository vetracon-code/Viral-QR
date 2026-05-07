const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let globalEndTime = null;

io.on('connection', (socket) => {
    socket.emit('init', { globalEndTime });
    socket.on('createMaster', (durationMinutes) => {
        if (!globalEndTime) {
            globalEndTime = Date.now() + (durationMinutes * 60000);
            io.emit('timerStarted', globalEndTime);
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('Server pronto'));
