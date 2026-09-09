import type { Server } from 'socket.io';

let ioInstance: Server | null = null;

export function setIo(instance: Server) {
  ioInstance = instance;
}

export function getIo(): Server {
  if (!ioInstance) {
    throw new Error('socket.io server not initialized yet');
  }
  return ioInstance;
}
