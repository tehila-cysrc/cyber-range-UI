import './env.js';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { createApp } from './app.js';
import { setIo } from './sockets/io.js';
import { setupSockets } from './sockets/index.js';
import { startClock } from './services/clock.service.js';
import { startAccessSessionExpirySweep } from './services/accessBroker/accessSessionExpiry.service.js';
import { seed } from './db/seed.js';

const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

// Initialize new deployments before accepting requests; existing active runs are preserved.
seed();

const app = createApp();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});
setIo(io);
setupSockets(io);
startClock();
startAccessSessionExpirySweep();

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
