const express  = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  maxHttpBufferSize: 8 * 1024 * 1024, // 8 MB per socket message (covers base64 chunks)
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Room state ────────────────────────────────────────────────────────────────
const rooms = new Map(); // code → { sender, receiver, created }

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // exclude ambiguous chars
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── Socket.io logic ───────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('[+] Connected:', socket.id);

  // Sender creates a room
  socket.on('create-room', (cb) => {
    let code;
    do { code = generateCode(); } while (rooms.has(code));

    rooms.set(code, { sender: socket.id, receiver: null, created: Date.now() });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'sender';

    console.log(`[room] Created: ${code}`);
    if (typeof cb === 'function') cb({ code });
  });

  // Receiver joins a room
  socket.on('join-room', (code, cb) => {
    if (typeof code !== 'string') return cb && cb({ error: 'Invalid code.' });
    code = code.toUpperCase().trim();

    const room = rooms.get(code);
    if (!room)         return cb && cb({ error: 'Room not found. Check the code.' });
    if (room.receiver) return cb && cb({ error: 'This session already has a receiver.' });

    room.receiver = socket.id;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'receiver';

    socket.to(code).emit('receiver-joined');
    console.log(`[room] ${code}: receiver joined`);
    if (typeof cb === 'function') cb({ ok: true });
  });

  // Pure relay — server never reads file content
  const RELAY = ['file-start', 'file-chunk', 'file-done', 'transfer-complete', 'cancel-transfer'];
  RELAY.forEach(evt => {
    socket.on(evt, (data, ack) => {
      const code = socket.data.roomCode;
      if (code) socket.to(code).emit(evt, data);
      if (typeof ack === 'function') ack(); // optional ack for flow control
    });
  });

  // Cleanup on disconnect
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (code && rooms.has(code)) {
      socket.to(code).emit('peer-disconnected');
      rooms.delete(code);
      console.log(`[room] ${code} closed (${socket.data.role} disconnected)`);
    }
    console.log('[-] Disconnected:', socket.id);
  });
});

// Purge rooms older than 2 hours every 15 minutes
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  rooms.forEach((room, code) => {
    if (room.created < cutoff) rooms.delete(code);
  });
}, 15 * 60 * 1000);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🔐 SecureTransfer running → http://localhost:${PORT}`);
});
