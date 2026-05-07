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
  users: {},
  duos: {},
  duoInvites: {}
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


  socket.on('duoInvite', data => {
    const sender = gameState.users[socket.id];
    const targetId = data && data.to;
    const target = gameState.users[targetId];

    if (!sender) {
      socket.emit('duoError', { message: 'Devi prima entrare nel gioco.' });
      return;
    }

    if (!target || !targetId) {
      socket.emit('duoError', { message: 'Partecipante non disponibile.' });
      return;
    }

    if (sender.outsideArea || target.outsideArea) {
      socket.emit('duoError', { message: 'Per creare un Duo dovete essere entrambi nell\'area di gioco.' });
      return;
    }

    if (sender.duoId || target.duoId) {
      socket.emit('duoError', { message: 'Uno dei due è già in un Duo.' });
      return;
    }

    const inviteId = `${socket.id}_${targetId}_${Date.now()}`;

    gameState.duoInvites[inviteId] = {
      id: inviteId,
      from: socket.id,
      to: targetId,
      createdAt: Date.now()
    };

    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.emit('duoInviteReceived', {
        inviteId,
        from: socket.id,
        fromNick: sender.nick
      });
    }
  });

  socket.on('duoAccept', data => {
    const inviteId = data && data.inviteId;
    const invite = gameState.duoInvites[inviteId];

    if (!invite || invite.to !== socket.id) {
      socket.emit('duoError', { message: 'Invito Duo non valido o scaduto.' });
      return;
    }

    const fromUser = gameState.users[invite.from];
    const toUser = gameState.users[invite.to];

    if (!fromUser || !toUser) {
      socket.emit('duoError', { message: 'Uno dei partecipanti non è più disponibile.' });
      delete gameState.duoInvites[inviteId];
      return;
    }

    if (fromUser.duoId || toUser.duoId) {
      socket.emit('duoError', { message: 'Uno dei due è già in un Duo.' });
      delete gameState.duoInvites[inviteId];
      return;
    }

    const duoId = `duo_${Date.now()}_${Math.floor(Math.random() * 9999)}`;

    gameState.duos[duoId] = {
      id: duoId,
      members: [invite.from, invite.to],
      createdAt: Date.now()
    };

    fromUser.duoId = duoId;
    toUser.duoId = duoId;

    delete gameState.duoInvites[inviteId];

    const fromSocket = io.sockets.sockets.get(invite.from);
    const toSocket = io.sockets.sockets.get(invite.to);

    if (fromSocket) {
      fromSocket.emit('duoCreated', {
        duoId,
        partnerId: toUser.id,
        partnerNick: toUser.nick
      });
    }

    if (toSocket) {
      toSocket.emit('duoCreated', {
        duoId,
        partnerId: fromUser.id,
        partnerNick: fromUser.nick
      });
    }

    broadcastMap();
  });

  socket.on('duoDecline', data => {
    const inviteId = data && data.inviteId;
    const invite = gameState.duoInvites[inviteId];

    if (!invite || invite.to !== socket.id) return;

    const decliningUser = gameState.users[socket.id];
    const fromSocket = io.sockets.sockets.get(invite.from);

    if (fromSocket) {
      fromSocket.emit('duoDeclinedNotice', {
        nick: decliningUser ? decliningUser.nick : 'Il partecipante'
      });
    }

    delete gameState.duoInvites[inviteId];
  });


  socket.on('adminRequestReset', () => {
    gameState = {
      name: 'Lumina Live',
      center: null,
      radiusMeters: 150,
      startedAt: null,
      endTime: null,
      active: false,
      users: {},
      duos: {},
      duoInvites: {}
    };

    io.emit('gameDeleted');
  });

  socket.on('disconnect', () => {
    const user = gameState.users[socket.id];

    if (user && user.duoId && gameState.duos[user.duoId]) {
      const duo = gameState.duos[user.duoId];
      const partnerId = duo.members.find(id => id !== socket.id);
      const partner = gameState.users[partnerId];

      if (partner) {
        delete partner.duoId;
        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (partnerSocket) {
          partnerSocket.emit('duoCreated', null);
        }
      }

      delete gameState.duos[user.duoId];
    }

    Object.keys(gameState.duoInvites || {}).forEach(inviteId => {
      const inv = gameState.duoInvites[inviteId];
      if (inv.from === socket.id || inv.to === socket.id) delete gameState.duoInvites[inviteId];
    });

    delete gameState.users[socket.id];
    broadcastMap();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Lumina Live server ready on port ${PORT}`);
});
