const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const OUTSIDE_GRACE_MS = 2 * 60 * 1000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let gameState = {
  name: 'Lumina Live',
  center: null,
  radiusMeters: 150,
  startedAt: null,
  endTime: null,
  active: false,
  users: {}
};

function distanceMeters(a, b) {
  if (!a || !b) return 0;

  const R = 6371000;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function evaluateUserArea(socket, user) {
  if (!gameState.active || !gameState.center || !user) return;

  const dist = distanceMeters(gameState.center, {
    lat: user.lat,
    lng: user.lng
  });

  user.distanceFromCenter = Math.round(dist);

  const outside = dist > gameState.radiusMeters;

  if (outside && !user.outsideArea) {
    user.outsideArea = true;
    user.outsideSince = Date.now();

    socket.emit('outsideAreaWarning', {
      graceSeconds: Math.round(OUTSIDE_GRACE_MS / 1000),
      radiusMeters: gameState.radiusMeters,
      distanceMeters: user.distanceFromCenter
    });
  }

  if (!outside && user.outsideArea) {
    user.outsideArea = false;
    user.outsideSince = null;

    socket.emit('backInsideArea');
  }
}

function normalizeNick(nick) {
  return String(nick || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isNickTaken(nick, currentSocketId = null) {
  const normalized = normalizeNick(nick);

  return Object.values(gameState.users).some(user => {
    if (!user || user.id === currentSocketId) return false;
    return normalizeNick(user.nick) === normalized;
  });
}

function makeNickSuggestion(baseNick) {
  const cleanBase = String(baseNick || 'Player').trim().replace(/\s+/g, ' ') || 'Player';

  for (let i = 2; i <= 99; i++) {
    const candidate = `${cleanBase}${i}`;
    if (!isNickTaken(candidate)) return candidate;
  }

  return `${cleanBase}${Math.floor(100 + Math.random() * 900)}`;
}

function broadcastMap() {
  io.emit('updateMap', gameState.users);
}

setInterval(() => {
  const now = Date.now();
  let changed = false;

  Object.values(gameState.users).forEach(user => {
    if (
      user.outsideArea &&
      user.outsideSince &&
      now - user.outsideSince > OUTSIDE_GRACE_MS
    ) {
      const targetSocket = io.sockets.sockets.get(user.id);
      if (targetSocket) {
        targetSocket.emit('removedOutsideArea');
      }

      delete gameState.users[user.id];
      changed = true;
    }
  });

  if (changed) broadcastMap();
}, 15000);

io.on('connection', socket => {
  socket.emit('sync', gameState);

  socket.on('adminStart', data => {
    const value = Math.max(1, Number(data.value) || 60);
    const durationMs = data.unit === 'hour'
      ? value * 3600000
      : value * 60000;

    gameState.name = data.name || 'Lumina Live';
    gameState.startedAt = Date.now();
    gameState.endTime = gameState.startedAt + durationMs;
    gameState.active = true;
    gameState.center = {
      lat: Number(data.lat),
      lng: Number(data.lng)
    };
    gameState.radiusMeters = Math.max(20, Number(data.radiusMeters) || 150);

    io.emit('timerStarted', {
      name: gameState.name,
      startedAt: gameState.startedAt,
      endTime: gameState.endTime,
      center: gameState.center,
      radiusMeters: gameState.radiusMeters
    });

    broadcastMap();
  });

  socket.on('registerUser', userData => {
    const requestedNick = String(userData.nick || 'Player').trim() || 'Player';

    if (isNickTaken(requestedNick, socket.id)) {
      socket.emit('nicknameTaken', {
        requested: requestedNick,
        suggestion: makeNickSuggestion(requestedNick)
      });
      return;
    }

    gameState.users[socket.id] = {
      id: socket.id,
      nick: requestedNick,
      role: userData.role || 'player',
      avatar: userData.avatar || { anon: true },
      lat: Number(userData.lat),
      lng: Number(userData.lng),
      outsideArea: false,
      outsideSince: null,
      distanceFromCenter: null
    };

    evaluateUserArea(socket, gameState.users[socket.id]);

    socket.emit('profileCreated', {
      id: socket.id,
      user: gameState.users[socket.id],
      game: gameState
    });

    broadcastMap();
  });

  socket.on('updatePosition', pos => {
    const user = gameState.users[socket.id];
    if (!user || !pos) return;

    user.lat = Number(pos.lat);
    user.lng = Number(pos.lng);

    evaluateUserArea(socket, user);
    broadcastMap();
  });

  socket.on('sendLike', data => {
    const targetId = data && data.to;
    const type = data && data.type;
    const sender = gameState.users[socket.id];
    const target = gameState.users[targetId];

    if (!sender) {
      socket.emit('interactionError', { message: 'Devi prima entrare nel gioco.' });
      return;
    }

    if (!targetId || !type || !target) {
      socket.emit('interactionError', { message: 'Utente non disponibile.' });
      return;
    }

    if (sender.outsideArea) {
      socket.emit('interactionError', {
        message: "Sei fuori dall'area di gioco. Rientra nel raggio dell'evento per interagire."
      });
      return;
    }

    if (target.outsideArea) {
      socket.emit('interactionError', {
        message: 'Questo utente è temporaneamente fuori area.'
      });
      return;
    }

    const targetSocket = io.sockets.sockets.get(targetId);
    if (!targetSocket) {
      socket.emit('interactionError', { message: 'Utente non più online.' });
      return;
    }

    targetSocket.emit('receiveLike', {
      from: socket.id,
      fromNick: sender.nick || 'Anonimo',
      type
    });
  });

  socket.on('adminRequestReset', () => {
    gameState = {
      name: 'Lumina Live',
      center: null,
      radiusMeters: 150,
      startedAt: null,
      endTime: null,
      active: false,
      users: {}
    };

    io.emit('gameDeleted');
  });

  socket.on('disconnect', () => {
    delete gameState.users[socket.id];
    broadcastMap();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Lumina Live server ready on port ${PORT}`);
});
