'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Device {
  id: string;
  name: string;
  ip: string;
  distance?: number;
  angle?: number;
}

interface DiscoverDevice {
  id: string;
  name: string;
  ip?: string;
}

interface DiscoverResponse {
  devices?: DiscoverDevice[];
}

interface PairRequest {
  requesterClientId: string;
  requesterDeviceId?: string;
  requesterName: string;
}

interface ReceivedFile {
  id: string;
  name: string;
  size: number;
  url: string;
}

interface IncomingFile {
  name: string;
  size: number;
  chunks: ArrayBuffer[];
  receivedSize: number;
}

const chunkSize = 16 * 1024;
const configuredWsUrl = process.env.NEXT_PUBLIC_WS_URL;

const deviceAdjectives = [
  'Brave',
  'Calm',
  'Clever',
  'Cozy',
  'Daring',
  'Gentle',
  'Happy',
  'Kind',
  'Lucky',
  'Neat',
  'Quick',
  'Sunny',
  'Swift',
  'Tiny',
  'Wise',
];

const deviceNames = [
  'Alya',
  'Bima',
  'Citra',
  'Dimas',
  'Elena',
  'Farah',
  'Gilang',
  'Hana',
  'Intan',
  'Juna',
  'Kirana',
  'Laras',
  'Mika',
  'Nadia',
  'Raka',
  'Salsa',
  'Tara',
  'Vino',
  'Wira',
  'Zara',
];

function generateDeviceName() {
  const adjective = deviceAdjectives[Math.floor(Math.random() * deviceAdjectives.length)];
  const name = deviceNames[Math.floor(Math.random() * deviceNames.length)];

  return `${adjective} ${name}`;
}

function generateDeviceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `device-${crypto.randomUUID()}`;
  }

  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';

  const sizes = ['B', 'KB', 'MB', 'GB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));

  return `${parseFloat((bytes / Math.pow(1024, index)).toFixed(2))} ${sizes[index]}`;
}

function getWebSocketUrl() {
  if (configuredWsUrl) return configuredWsUrl;

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

  return `${protocol}://${window.location.hostname}:3001`;
}

export default function Home() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [scanAngle, setScanAngle] = useState(0);
  const [status, setStatus] = useState('Menyiapkan radar otomatis...');
  const [pairRequests, setPairRequests] = useState<PairRequest[]>([]);
  const [pairedName, setPairedName] = useState('');
  const [pairingTargetId, setPairingTargetId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([]);

  const scanAngleRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const peerClientIdRef = useRef('');
  const pairedNameRef = useRef('');
  const incomingRef = useRef<IncomingFile | null>(null);
  const urlsRef = useRef<string[]>([]);

  const positionDevices = useCallback((deviceList: Device[]) => {
    return deviceList.map((device, index) => {
      const angle = (index / Math.max(deviceList.length, 1)) * Math.PI * 2 + Math.random() * 0.5;
      const distance = 30 + Math.random() * 40;

      return { ...device, angle, distance };
    });
  }, []);

  const getPosition = (angle: number, distance: number) => {
    const x = 50 + distance * Math.cos(angle) * 0.8;
    const y = 50 + distance * Math.sin(angle) * 0.8;

    return { x, y };
  };

  const sendSocket = useCallback((payload: unknown) => {
    const socket = socketRef.current;

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }, []);

  const handleChannelMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data === 'string') {
      const msg = JSON.parse(event.data);

      if (msg.type === 'file-start') {
        incomingRef.current = { name: msg.name, size: msg.size, chunks: [], receivedSize: 0 };
        setProgress(0);
        setStatus(`Menerima ${msg.name} langsung dari ${pairedNameRef.current || 'peer'}...`);
      }

      if (msg.type === 'file-end' && incomingRef.current) {
        const incoming = incomingRef.current;
        const blob = new Blob(incoming.chunks);
        const url = URL.createObjectURL(blob);

        urlsRef.current.push(url);
        setReceivedFiles((current) => [...current, { id: `${incoming.name}-${Date.now()}`, name: incoming.name, size: incoming.size, url }]);
        incomingRef.current = null;
        setProgress(100);
      }

      if (msg.type === 'transfer-complete') {
        setStatus('Transfer P2P selesai. File tidak pernah disimpan di server.');
      }

      return;
    }

    const incoming = incomingRef.current;
    if (!incoming) return;

    const chunk = event.data as ArrayBuffer;
    incoming.chunks.push(chunk);
    incoming.receivedSize += chunk.byteLength;
    setProgress(Math.min(100, Math.round((incoming.receivedSize / incoming.size) * 100)));
  }, []);

  const attachChannel = useCallback((channel: RTCDataChannel) => {
    channel.binaryType = 'arraybuffer';
    channelRef.current = channel;
    channel.onopen = () => {
      setIsConnected(true);
      setStatus(`Terhubung dengan ${pairedNameRef.current || 'peer'}. Siap bertukar file.`);
    };
    channel.onclose = () => {
      setIsConnected(false);
      setStatus('Koneksi peer terputus.');
    };
    channel.onmessage = handleChannelMessage;
  }, [handleChannelMessage]);

  const createPeer = useCallback(async (targetClientId: string, shouldOffer: boolean) => {
    peerRef.current?.close();
    peerClientIdRef.current = targetClientId;

    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peerRef.current = peer;

    peer.ondatachannel = (event) => attachChannel(event.channel);
    peer.onicecandidate = (event) => {
      if (event.candidate && peerClientIdRef.current) {
        sendSocket({ type: 'signal', targetId: peerClientIdRef.current, signal: { candidate: event.candidate } });
      }
    };

    if (shouldOffer) {
      attachChannel(peer.createDataChannel('files'));
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      sendSocket({ type: 'signal', targetId: targetClientId, signal: { description: offer } });
    }
  }, [attachChannel, sendSocket]);

  const requestPairing = (device: Device) => {
    setPairingTargetId(device.id);
    pairedNameRef.current = device.name;
    setPairedName(device.name);
    setStatus(`Mengirim pairing request ke ${device.name}...`);
    sendSocket({ type: 'pair-request', targetDeviceId: device.id });
  };

  const approvePairing = (request: PairRequest) => {
    setPairRequests((current) => current.filter((item) => item.requesterClientId !== request.requesterClientId));
    pairedNameRef.current = request.requesterName;
    setPairedName(request.requesterName);
    setStatus(`Pairing dengan ${request.requesterName} diterima. Membuat room P2P...`);
    sendSocket({ type: 'approve-pair', requesterClientId: request.requesterClientId });
  };

  const rejectPairing = (request: PairRequest) => {
    setPairRequests((current) => current.filter((item) => item.requesterClientId !== request.requesterClientId));
    sendSocket({ type: 'reject-pair', requesterClientId: request.requesterClientId });
  };

  const sendFiles = async (files: FileList | null) => {
    const channel = channelRef.current;
    if (!files?.length || !channel || channel.readyState !== 'open') return;

    setIsSending(true);

    for (const file of Array.from(files)) {
      channel.send(JSON.stringify({ type: 'file-start', name: file.name, size: file.size }));

      for (let offset = 0; offset < file.size; offset += chunkSize) {
        while (channel.bufferedAmount > chunkSize * 64) {
          await new Promise((resolve) => setTimeout(resolve, 30));
        }

        channel.send(await file.slice(offset, offset + chunkSize).arrayBuffer());
        setProgress(Math.min(100, Math.round(((offset + chunkSize) / file.size) * 100)));
      }

      channel.send(JSON.stringify({ type: 'file-end', name: file.name }));
    }

    channel.send(JSON.stringify({ type: 'transfer-complete' }));
    setIsSending(false);
    setStatus('Transfer P2P selesai dikirim langsung antar browser.');
  };

  useEffect(() => {
    const interval = setInterval(() => {
      scanAngleRef.current = (scanAngleRef.current + 2) % 360;
      setScanAngle(scanAngleRef.current);
    }, 30);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const storedId = window.localStorage.getItem('wifi-beam-device-id') || generateDeviceId();
    const storedName = window.localStorage.getItem('wifi-beam-device-name') || generateDeviceName();

    window.localStorage.setItem('wifi-beam-device-id', storedId);
    window.localStorage.setItem('wifi-beam-device-name', storedName);
    setDeviceId(storedId);
    setDeviceName(storedName);
  }, []);

  useEffect(() => {
    if (!deviceId || !deviceName) return;

    const announce = async () => {
      try {
        await fetch('/api/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: deviceId, name: deviceName }),
        });
      } catch (error) {
        console.error('Heartbeat error:', error);
      }
    };

    announce();
    const interval = setInterval(announce, 2000);

    return () => clearInterval(interval);
  }, [deviceId, deviceName]);

  useEffect(() => {
    if (!deviceId || !deviceName) return;

    let isMounted = true;

    const connect = async () => {
      try {
        await fetch('/api/ws');
        if (!isMounted) return;

        const socket = new WebSocket(getWebSocketUrl());
        socketRef.current = socket;

        socket.onopen = () => {
          socket.send(JSON.stringify({ type: 'register-client', deviceId, name: deviceName }));
          setStatus('Radar aktif. Pilih perangkat untuk pairing.');
        };

        socket.onmessage = async (event) => {
          const msg = JSON.parse(event.data);

          if (msg.type === 'pair-request') {
            setPairRequests((current) => {
              if (current.some((request) => request.requesterClientId === msg.requesterClientId)) return current;

              return [...current, {
                requesterClientId: msg.requesterClientId,
                requesterDeviceId: msg.requesterDeviceId,
                requesterName: msg.requesterName || 'Perangkat lain',
              }];
            });
            setStatus(`${msg.requesterName || 'Perangkat lain'} meminta pairing.`);
          }

          if (msg.type === 'pair-request-sent') {
            setStatus('Pairing request terkirim. Menunggu accept...');
          }

          if (msg.type === 'pair-rejected') {
            setPairingTargetId('');
            pairedNameRef.current = '';
            setStatus('Pairing request ditolak.');
          }

          if (msg.type === 'pair-approved') {
            setPairingTargetId('');
            peerClientIdRef.current = msg.peerClientId;
            if (msg.peerName) {
              pairedNameRef.current = msg.peerName;
              setPairedName(msg.peerName);
            }
            setStatus('Pairing diterima. Menyambungkan WebRTC...');
            await createPeer(msg.peerClientId, Boolean(msg.initiator));
          }

          if (msg.type === 'peer-left') {
            peerRef.current?.close();
            channelRef.current?.close();
            pairedNameRef.current = '';
            setIsConnected(false);
            setStatus('Peer keluar dari room.');
          }

          if (msg.type === 'signal') {
            const peer = peerRef.current;
            if (!peer) return;

            peerClientIdRef.current = msg.fromId || peerClientIdRef.current;

            if (msg.signal?.description) {
              await peer.setRemoteDescription(msg.signal.description);

              if (msg.signal.description.type === 'offer') {
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                sendSocket({ type: 'signal', targetId: peerClientIdRef.current, signal: { description: answer } });
              }
            }

            if (msg.signal?.candidate) {
              await peer.addIceCandidate(msg.signal.candidate);
            }
          }
        };

        socket.onerror = () => setStatus('Signaling gagal tersambung. Pastikan server mengizinkan WebSocket port 3001.');
      } catch (error) {
        console.error('Signaling error:', error);
        setStatus('Gagal memulai signaling WebRTC.');
      }
    };

    connect();

    return () => {
      isMounted = false;
      socketRef.current?.close();
    };
  }, [createPeer, deviceId, deviceName, sendSocket]);

  useEffect(() => {
    if (!deviceId) return;

    const pollDevices = async () => {
      try {
        const res = await fetch('/api/discover');
        if (!res.ok) return;

        const data = await res.json() as DiscoverResponse;
        const discovered = (data.devices ?? [])
          .filter((device) => device.id !== deviceId)
          .map((device) => ({ id: device.id, name: device.name, ip: device.ip ?? '' }));

        setDevices(positionDevices(discovered));
      } catch (error) {
        console.error('Discovery error:', error);
      }
    };

    pollDevices();
    const interval = setInterval(pollDevices, 2000);

    return () => clearInterval(interval);
  }, [deviceId, positionDevices]);

  useEffect(() => {
    const urls = urlsRef.current;

    return () => {
      socketRef.current?.close();
      peerRef.current?.close();
      channelRef.current?.close();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080a18] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(45,212,191,0.28),transparent_32%),radial-gradient(circle_at_80%_0%,rgba(129,140,248,0.26),transparent_30%),radial-gradient(circle_at_50%_90%,rgba(244,114,182,0.16),transparent_34%)]" />
      <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '42px 42px' }} />

      <header className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-5 sm:py-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <div>
          <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200 shadow-2xl shadow-cyan-950/30 backdrop-blur sm:text-xs sm:tracking-[0.25em]">
            <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.9)]" />
            Auto peer radar
          </div>
          <h1 className="font-[var(--font-display)] text-4xl font-bold tracking-[-0.04em] text-white min-[380px]:text-5xl sm:text-6xl">WiFi Beam</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
            Perangkat langsung aktif dengan nama acak. Pilih device yang terscan, accept pairing, lalu bertukar file langsung client ke client via WebRTC.
          </p>
        </div>

        <div className="w-full rounded-3xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-4 shadow-[0_18px_60px_rgba(34,211,238,0.12)] backdrop-blur md:w-auto md:px-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200 sm:text-xs sm:tracking-[0.25em]">Nama device</p>
          <div className="mt-2 flex flex-col gap-3 min-[380px]:flex-row min-[380px]:items-center min-[380px]:justify-between md:justify-start">
            <strong className="min-w-0 break-words text-lg leading-tight text-white">{deviceName || 'Membuat nama...'}</strong>
            <button
              type="button"
              onClick={() => {
                const nextName = generateDeviceName();
                window.localStorage.setItem('wifi-beam-device-name', nextName);
                setDeviceName(nextName);
              }}
              className="w-full rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-cyan-100 transition hover:bg-white/10 min-[380px]:w-auto min-[380px]:py-1"
            >
              Random
            </button>
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto grid w-full max-w-7xl gap-5 px-4 pb-8 pt-2 sm:px-5 sm:pb-10 sm:pt-4 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8 lg:px-8">
        <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:min-h-[520px] sm:rounded-[2.5rem] sm:p-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(45,212,191,0.18),transparent_42%)]" />
          <div className="relative mb-5 flex flex-col gap-3 min-[380px]:flex-row min-[380px]:items-start min-[380px]:justify-between sm:mb-6 sm:items-center">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200 sm:text-xs sm:tracking-[0.3em]">Radar field</p>
              <h2 className="mt-1 font-[var(--font-display)] text-xl font-bold sm:text-2xl">Scan perangkat aktif</h2>
              <p className="mt-1 text-xs text-slate-400">Tidak ada pilihan sender/receiver di awal.</p>
            </div>
            <div className="w-fit rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-[11px] font-bold text-emerald-200 sm:px-4 sm:text-xs">Scanning</div>
          </div>

          <div className="relative mx-auto aspect-square w-[min(100%,78vw)] max-w-[430px] rounded-full border border-cyan-300/20 bg-slate-950/40 shadow-[inset_0_0_80px_rgba(34,211,238,0.08)] sm:w-full">
            {[25, 50, 75].map((radius) => (
              <div
                key={radius}
                className="absolute rounded-full border border-cyan-300/20 shadow-[0_0_28px_rgba(34,211,238,0.08)]"
                style={{ width: `${radius * 2}%`, height: `${radius * 2}%`, left: `${50 - radius}%`, top: `${50 - radius}%` }}
              />
            ))}

            <div className="absolute inset-0 flex items-center justify-center"><div className="h-px w-full bg-cyan-300/15" /></div>
            <div className="absolute inset-0 flex items-center justify-center"><div className="h-full w-px bg-cyan-300/15" /></div>

            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="h-6 w-6 rounded-full border-[3px] border-slate-950 bg-cyan-300 shadow-[0_0_45px_rgba(34,211,238,0.8)] sm:h-8 sm:w-8 sm:border-4" />
              <div className="absolute -bottom-8 left-1/2 max-w-[160px] -translate-x-1/2 truncate rounded-full bg-cyan-300 px-3 py-1 text-[10px] font-black text-slate-950 sm:max-w-none sm:whitespace-nowrap sm:text-xs">
                {deviceName || 'You'}
              </div>
            </div>

            <div
              className="absolute left-1/2 top-1/2 h-0.5 w-1/2 origin-left bg-gradient-to-r from-cyan-200 to-transparent"
              style={{ transform: `rotate(${scanAngle}deg)`, boxShadow: '0 0 32px rgba(34, 211, 238, 0.7)' }}
            />

            {devices.map((device) => {
              const pos = getPosition(device.angle || 0, device.distance || 50);
              const isPairing = pairingTargetId === device.id;

              return (
                <button
                  key={device.id}
                  type="button"
                  onClick={() => requestPairing(device)}
                  disabled={isConnected || Boolean(pairingTargetId)}
                  className="absolute transition-all duration-500 disabled:cursor-not-allowed"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
                >
                  <div className="h-4 w-4 animate-ping rounded-full bg-fuchsia-300 text-fuchsia-300 shadow-[0_0_24px_currentColor] sm:h-5 sm:w-5" />
                  <div className="absolute -top-9 left-1/2 max-w-[120px] -translate-x-1/2 truncate rounded-full border border-fuchsia-300/30 bg-fuchsia-300/15 px-2.5 py-1 text-[10px] font-black text-fuchsia-100 backdrop-blur sm:-top-10 sm:max-w-none sm:whitespace-nowrap sm:px-3 sm:text-xs">
                    {isPairing ? 'Menunggu...' : device.name}
                  </div>
                </button>
              );
            })}

            <div className="pointer-events-none absolute left-1/2 top-1/2 w-1/2" style={{ transform: `rotate(${scanAngle}deg)`, transformOrigin: 'left center' }}>
              <div className="h-20 w-full bg-gradient-to-r from-cyan-300/25 to-transparent blur-xl sm:h-32" />
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.07] p-4 shadow-2xl shadow-black/25 backdrop-blur-2xl sm:rounded-[2.5rem] sm:p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-fuchsia-200 sm:text-xs sm:tracking-[0.3em]">Devices</p>
                <h3 className="mt-1 font-[var(--font-display)] text-xl font-bold sm:text-2xl">Terdeteksi</h3>
              </div>
              <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-75" /><span className="relative inline-flex h-3 w-3 rounded-full bg-cyan-200" /></span>
            </div>

            {devices.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-white/15 bg-slate-950/30 p-6 text-center sm:rounded-[2rem] sm:p-8">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-white/10 text-2xl sm:mb-5 sm:h-16 sm:w-16 sm:text-3xl">⌁</div>
                <p className="font-bold text-slate-200">Belum ada perangkat</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">Buka aplikasi ini di device lain pada server yang sama.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {devices.map((device) => (
                  <div key={device.id} className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/10 p-4 transition hover:border-cyan-300/30 hover:bg-white/[0.14] min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-fuchsia-300 font-black text-slate-950 sm:h-12 sm:w-12">↔</div>
                      <div className="min-w-0">
                        <div className="truncate font-bold">{device.name}</div>
                        <div className="text-sm text-slate-400">Aktif dan siap pairing</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => requestPairing(device)}
                      disabled={isConnected || Boolean(pairingTargetId)}
                      className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 min-[420px]:w-auto min-[420px]:py-2"
                    >
                      Pair
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {pairRequests.length > 0 && (
            <div className="rounded-[1.75rem] border border-cyan-300/20 bg-cyan-300/10 p-4 backdrop-blur sm:rounded-[2rem] sm:p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200 sm:text-xs sm:tracking-[0.25em]">Pairing request</p>
              <div className="mt-4 grid gap-3">
                {pairRequests.map((request) => (
                  <div key={request.requesterClientId} className="rounded-3xl border border-white/10 bg-slate-950/30 p-4">
                    <p className="break-words font-bold">{request.requesterName}</p>
                    <p className="mt-1 text-sm text-slate-400">Ingin masuk room untuk bertukar file.</p>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => approvePairing(request)} className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 sm:py-2">Accept</button>
                      <button type="button" onClick={() => rejectPairing(request)} className="rounded-2xl border border-white/15 px-4 py-3 text-sm font-black text-white sm:py-2">Tolak</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.07] p-4 shadow-2xl shadow-black/25 backdrop-blur-2xl sm:rounded-[2.5rem] sm:p-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-200 sm:text-xs sm:tracking-[0.3em]">Room P2P</p>
            <h3 className="mt-1 break-words font-[var(--font-display)] text-xl font-bold sm:text-2xl">{isConnected ? `Terhubung: ${pairedName}` : 'Belum pairing'}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">{status}</p>

            <label className={`mt-5 flex cursor-pointer items-center justify-center rounded-2xl px-4 py-4 text-center font-black transition ${isConnected ? 'bg-gradient-to-r from-cyan-300 to-fuchsia-300 text-slate-950 hover:scale-[1.01]' : 'bg-slate-800 text-slate-500'}`}>
              {isSending ? 'Mengirim...' : 'Pilih File untuk Dikirim'}
              <input type="file" multiple disabled={!isConnected || isSending} onChange={(event) => void sendFiles(event.target.files)} className="hidden" />
            </label>

            {progress > 0 && (
              <div className="mt-5">
                <div className="mb-2 flex justify-between text-xs font-bold text-slate-300"><span>Progress</span><span>{progress}%</span></div>
                <div className="h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-cyan-300 transition-all" style={{ width: `${progress}%` }} /></div>
              </div>
            )}

            {receivedFiles.length > 0 && (
              <div className="mt-5 grid gap-3">
                {receivedFiles.map((file) => (
                  <a key={file.id} href={file.url} download={file.name} className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-slate-950/30 p-4 transition hover:bg-white/10 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
                    <span className="break-words font-bold">{file.name}</span>
                    <span className="shrink-0 text-sm text-slate-400">{formatSize(file.size)}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </aside>
      </section>

      <div className="relative z-10 px-4 pb-6 sm:px-5 sm:pb-8 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-[1.5rem] border border-white/10 bg-white/[0.06] px-4 py-4 text-sm leading-6 text-slate-300 backdrop-blur sm:rounded-[2rem] sm:px-5 sm:py-5">
          File yang dikirim tidak pernah disimpan di server. 
        </div>
      </div>
    </main>
  );
}
