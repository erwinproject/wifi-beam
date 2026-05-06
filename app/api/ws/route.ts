import { NextResponse } from 'next/server';
import type WebSocketType from 'ws';
import type { WebSocketServer as WebSocketServerType } from 'ws';

export const dynamic = 'force-dynamic';

process.env.WS_NO_BUFFER_UTIL = '1';
process.env.WS_NO_UTF_8_VALIDATE = '1';

type WebSocketConstructor = typeof import('ws').default;

let WebSocket: WebSocketConstructor | null = null;
let WebSocketServer: typeof WebSocketServerType | null = null;

interface SignalingClient {
  id: string;
  deviceId?: string;
  name?: string;
  roomId?: string;
  pairedWith?: string;
  role?: 'host' | 'receiver';
  pin?: string;
  socket: WebSocketType;
}

let wss: WebSocketServerType | null = null;
const wsPort = Number(process.env.WS_PORT || 3001);
const publicWsUrl = process.env.NEXT_PUBLIC_WS_URL || `ws://localhost:${wsPort}`;
const clients = new Map<string, SignalingClient>();
const rooms = new Map<string, { hostId: string; pin?: string }>();
const deviceClients = new Map<string, string>();
const pendingPairRequests = new Map<string, string>();

function pairKey(requesterClientId: string, targetClientId: string) {
  return `${requesterClientId}->${targetClientId}`;
}

function removePendingPairsFor(clientId: string) {
  pendingPairRequests.forEach((_, key) => {
    if (key.startsWith(`${clientId}->`) || key.endsWith(`->${clientId}`)) {
      pendingPairRequests.delete(key);
    }
  });
}

function send(ws: WebSocketType, payload: unknown) {
  if (WebSocket && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendTo(clientId: string, payload: unknown) {
  const client = clients.get(clientId);
  if (client) send(client.socket, payload);
}

function removeClient(clientId: string) {
  const client = clients.get(clientId);
  clients.delete(clientId);

  if (client?.deviceId) {
    deviceClients.delete(client.deviceId);
  }

  removePendingPairsFor(clientId);

  if (client?.pairedWith) {
    const peer = clients.get(client.pairedWith);
    if (peer) {
      peer.pairedWith = undefined;
      send(peer.socket, { type: 'peer-left' });
    }
  }

  if (client?.role === 'host' && client.roomId) {
    rooms.delete(client.roomId);
    clients.forEach((other) => {
      if (other.roomId === client.roomId) {
        send(other.socket, { type: 'room-closed' });
      }
    });
  }
}

export async function GET() {
  if (!WebSocket || !WebSocketServer) {
    const wsPackage = await import('ws');
    WebSocket = wsPackage.default;
    WebSocketServer = wsPackage.WebSocketServer;
  }

  if (!wss) {
    wss = new WebSocketServer({ port: wsPort });
    wss.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.warn(`WebRTC signaling server already running on port ${wsPort}.`);
        return;
      }

      console.error('WebRTC signaling server error:', error);
    });

    wss.on('connection', (ws) => {
      const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      clients.set(clientId, { id: clientId, socket: ws });
      send(ws, { type: 'ready', clientId });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          const client = clients.get(clientId);
          if (!client) return;

          if (msg.type === 'register-client') {
            const deviceId = String(msg.deviceId || '').trim();
            if (!deviceId) return;

            client.deviceId = deviceId;
            client.name = String(msg.name || 'Unknown Device');
            client.role = msg.role === 'host' ? 'host' : msg.role === 'receiver' ? 'receiver' : undefined;
            deviceClients.set(deviceId, clientId);
            send(ws, { type: 'client-registered', clientId, deviceId });
          }

          if (msg.type === 'pair-request') {
            const targetDeviceId = String(msg.targetDeviceId || '').trim();
            const targetClientId = deviceClients.get(targetDeviceId);

            if (!targetClientId || targetClientId === clientId) {
              send(ws, { type: 'pair-rejected', error: 'Perangkat tidak aktif.' });
              return;
            }

            if (client.pairedWith) {
              send(ws, { type: 'pair-rejected', error: 'Perangkat sudah berada di room.' });
              return;
            }

            const target = clients.get(targetClientId);
            if (target?.pairedWith) {
              send(ws, { type: 'pair-rejected', error: 'Target sudah berada di room.' });
              return;
            }

            pendingPairRequests.set(pairKey(clientId, targetClientId), clientId);

            sendTo(targetClientId, {
              type: 'pair-request',
              requesterClientId: clientId,
              requesterDeviceId: client.deviceId,
              requesterName: client.name || 'Perangkat lain',
            });
            send(ws, { type: 'pair-request-sent', targetDeviceId });
          }

          if (msg.type === 'approve-pair' && typeof msg.requesterClientId === 'string') {
            const requester = clients.get(msg.requesterClientId);

            if (!requester) {
              send(ws, { type: 'pair-rejected', error: 'Requester sudah tidak aktif.' });
              return;
            }

            const pendingKey = pairKey(requester.id, client.id);
            if (!pendingPairRequests.has(pendingKey)) {
              send(ws, { type: 'pair-rejected', error: 'Pairing request sudah tidak aktif.' });
              return;
            }

            if (client.pairedWith || requester.pairedWith) {
              send(ws, { type: 'pair-rejected', error: 'Salah satu perangkat sudah berada di room.' });
              return;
            }

            client.pairedWith = requester.id;
            requester.pairedWith = client.id;
            pendingPairRequests.delete(pendingKey);
            pendingPairRequests.delete(pairKey(client.id, requester.id));
            sendTo(requester.id, { type: 'pair-approved', peerClientId: client.id, peerName: client.name || 'Peer', initiator: true });
            send(ws, { type: 'pair-approved', peerClientId: requester.id, peerName: requester.name || 'Peer', initiator: false });
          }

          if (msg.type === 'reject-pair' && typeof msg.requesterClientId === 'string') {
            pendingPairRequests.delete(pairKey(msg.requesterClientId, clientId));
            sendTo(msg.requesterClientId, { type: 'pair-rejected', error: 'Pairing ditolak.' });
          }

          if (msg.type === 'host-room') {
            const roomId = String(msg.roomId || '').trim();
            if (!roomId) return;

            client.roomId = roomId;
            client.role = 'host';
            client.deviceId = typeof msg.deviceId === 'string' ? msg.deviceId : client.deviceId;
            client.name = typeof msg.name === 'string' ? msg.name : client.name;
            client.pin = typeof msg.pin === 'string' && msg.pin.trim() ? msg.pin.trim() : undefined;
            if (client.deviceId) deviceClients.set(client.deviceId, clientId);
            rooms.set(roomId, { hostId: clientId, pin: client.pin });
            send(ws, { type: 'room-hosted', roomId });
          }

          if (msg.type === 'request-join') {
            const hostDeviceId = String(msg.hostDeviceId || '').trim();
            const hostClientId = deviceClients.get(hostDeviceId);

            if (!hostClientId) {
              send(ws, { type: 'join-error', error: 'Sender tidak aktif atau belum membuka room.' });
              return;
            }

            sendTo(hostClientId, {
              type: 'join-request',
              receiverClientId: clientId,
              receiverDeviceId: client.deviceId,
              receiverName: client.name || msg.receiverName || 'Receiver',
              pin: typeof msg.pin === 'string' ? msg.pin.trim() : '',
            });
            send(ws, { type: 'join-request-sent' });
          }

          if (msg.type === 'approve-join' && typeof msg.receiverClientId === 'string') {
            if (!client.roomId) {
              send(ws, { type: 'join-error', error: 'Room sender belum aktif.' });
              return;
            }

            const room = rooms.get(client.roomId);
            const pin = typeof msg.pin === 'string' ? msg.pin.trim() : '';

            if (room?.pin && room.pin !== pin) {
              sendTo(msg.receiverClientId, { type: 'join-error', error: 'PIN room salah.' });
              return;
            }

            const receiver = clients.get(msg.receiverClientId);
            if (receiver) {
              receiver.roomId = client.roomId;
              receiver.role = 'receiver';
            }

            sendTo(msg.receiverClientId, { type: 'join-approved', roomId: client.roomId, hostId: clientId });
            send(ws, { type: 'receiver-approved', receiverId: msg.receiverClientId });
          }

          if (msg.type === 'reject-join' && typeof msg.receiverClientId === 'string') {
            sendTo(msg.receiverClientId, { type: 'join-error', error: 'Sender menolak request masuk room.' });
          }

          if (msg.type === 'join-room') {
            const roomId = String(msg.roomId || '').trim();
            const room = rooms.get(roomId);
            const pin = typeof msg.pin === 'string' ? msg.pin.trim() : '';

            if (!room) {
              send(ws, { type: 'join-error', error: 'Room tidak ditemukan atau sender belum aktif.' });
              return;
            }

            if (room.pin && room.pin !== pin) {
              send(ws, { type: 'join-error', error: 'PIN room salah.' });
              return;
            }

            client.roomId = roomId;
            client.role = 'receiver';
            send(ws, { type: 'join-accepted', roomId, hostId: room.hostId });
            sendTo(room.hostId, { type: 'receiver-joined', receiverId: clientId });
          }

          if (msg.type === 'signal' && typeof msg.targetId === 'string') {
            sendTo(msg.targetId, {
              type: 'signal',
              fromId: clientId,
              signal: msg.signal,
            });
          }
        } catch (error) {
          console.error('WS signaling error:', error);
        }
      });

      ws.on('close', () => removeClient(clientId));
      ws.on('error', () => removeClient(clientId));
    });
  }

  return NextResponse.json({ status: 'WebRTC signaling server running', wsUrl: publicWsUrl });
}
