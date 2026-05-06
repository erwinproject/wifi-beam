import { NextRequest, NextResponse } from 'next/server';
import { activeDevices } from '../registry';

interface DevicePayload {
  id?: string;
  name?: string;
  ip?: string;
  isHost?: boolean;
  roomId?: string;
  hasPin?: boolean;
}

// Clean up stale devices (15 seconds)
setInterval(() => {
  const now = Date.now();
  activeDevices.forEach((device, id) => {
    if (now - device.lastSeen > 15000) {
      activeDevices.delete(id);
    }
  });
}, 10000);

export async function GET(request: NextRequest) {
  void request;
  const devices = Array.from(activeDevices.values());

  return NextResponse.json({ devices }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function POST(request: NextRequest) {
  const deviceData = await request.json() as DevicePayload;
  const deviceId = deviceData.id || `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const stripV6Prefix = (addr: string) => addr.replace(/^::ffff:/, '');
  const rawForwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const forwardedFor = rawForwardedFor ? stripV6Prefix(rawForwardedFor) : undefined;
  const hostIp = request.headers.get('host')?.split(':')[0];
  const requestIp = forwardedFor && forwardedFor !== '::1' ? forwardedFor : hostIp;
  const existingDevice = activeDevices.get(deviceId);
  
  activeDevices.set(deviceId, {
    id: deviceId,
    name: deviceData.name || 'Unknown Device',
    ip: deviceData.ip || requestIp || 'localhost',
    isHost: deviceData.isHost || false,
    lastSeen: Date.now(),
    roomId: deviceData.roomId ?? existingDevice?.roomId,
    hasPin: deviceData.hasPin ?? existingDevice?.hasPin ?? false,
  });

  return NextResponse.json({ success: true, id: deviceId }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

