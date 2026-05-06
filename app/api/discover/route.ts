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

function stripV6Prefix(addr: string) {
  return addr.replace(/^::ffff:/, '');
}

function getRequestIp(request: NextRequest) {
  const rawForwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const forwardedFor = rawForwardedFor ? stripV6Prefix(rawForwardedFor) : undefined;
  const realIp = request.headers.get('x-real-ip');
  const hostIp = request.headers.get('host')?.split(':')[0];

  return forwardedFor && forwardedFor !== '::1' ? forwardedFor : realIp || hostIp || 'localhost';
}

function getNetworkKey(ip: string) {
  const normalizedIp = stripV6Prefix(ip);
  const octets = normalizedIp.split('.');

  if (octets.length === 4 && octets.every((octet) => /^\d+$/.test(octet))) {
    return `${octets[0]}.${octets[1]}.${octets[2]}`;
  }

  return normalizedIp;
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
  const requestNetworkKey = getNetworkKey(getRequestIp(request));
  const devices = Array.from(activeDevices.values())
    .filter((device) => device.networkKey === requestNetworkKey);

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
  const requestIp = getRequestIp(request);
  const existingDevice = activeDevices.get(deviceId);
  const deviceIp = deviceData.ip || requestIp;
  
  activeDevices.set(deviceId, {
    id: deviceId,
    name: deviceData.name || 'Unknown Device',
    ip: deviceIp,
    networkKey: getNetworkKey(deviceIp),
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

