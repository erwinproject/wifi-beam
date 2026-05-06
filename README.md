# WiFi Beam

Aplikasi web untuk berbagi file langsung antar browser menggunakan WebRTC DataChannel. Server hanya dipakai untuk discovery dan signaling, sedangkan file dikirim peer-to-peer dari device pengirim ke device penerima.

![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-cyan?style=flat&logo=tailwindcss)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P-green?style=flat)

## Fitur

| Fitur | Deskripsi |
| --- | --- |
| Auto Device Name | Setiap browser otomatis mendapat nama device acak |
| Radar Discovery | Device lain yang aktif akan muncul di radar |
| Pairing Approval | Penerima harus menyetujui pairing sebelum koneksi dibuat |
| WebRTC P2P | File dikirim langsung antar browser via DataChannel |
| WebSocket Signaling | Server WebSocket dipakai untuk bertukar offer, answer, dan ICE candidate |
| Progress Transfer | Progress kirim dan terima ditampilkan secara real-time |
| Responsive UI | Bisa dipakai dari desktop maupun mobile browser |

## Prerequisites

- Node.js 18 atau lebih baru, direkomendasikan Node.js 20 LTS
- npm
- Browser modern yang mendukung WebRTC

## Instalasi

```bash
npm install
```

## Environment

Buat file `.env` di root project.

Untuk development lokal:

```env
WS_PORT="3001"
NEXT_PUBLIC_WS_URL="ws://localhost:3001"
```

Untuk production dengan HTTPS dan reverse proxy:

```env
APP_PASSWORD="surabaya"
WS_PORT="3001"
NEXT_PUBLIC_WS_URL="wss://air-ws.cains.id"
```

`NEXT_PUBLIC_WS_URL` dibaca oleh frontend saat build. Setelah mengubah nilai ini, jalankan build ulang dan restart app.

## Development

```bash
npm run dev
```

Aplikasi utama berjalan di:

```text
http://localhost:3000
```

Endpoint `/api/ws` akan menyalakan WebSocket signaling server di port `WS_PORT`.

```text
http://localhost:3000/api/ws
```

## Production

Build aplikasi:

```bash
npm run build
```

Jalankan aplikasi:

```bash
npm run start
```

Jika memakai PM2:

```bash
pm2 restart nama-app --update-env
```

## Docker

Project ini sudah dilengkapi konfigurasi Docker untuk menjalankan aplikasi Next.js dalam mode production dengan output `standalone`.

File yang digunakan:

- `Dockerfile`
- `.dockerignore`
- `docker-compose.yml`

Build dan jalankan container:

```bash
docker compose up -d --build
```

Aplikasi akan berjalan di:

```text
http://localhost:3000
```

Lihat log container:

```bash
docker compose logs -f
```

Stop container:

```bash
docker compose down
```

Konfigurasi default di `docker-compose.yml` membatasi RAM container ke `512 MB`:

```yaml
mem_limit: 512m
environment:
  NODE_OPTIONS: --max-old-space-size=384
```

`mem_limit` membatasi RAM container Docker, sedangkan `NODE_OPTIONS` membatasi heap Node.js agar tidak memakai seluruh limit RAM container.

Jika server memiliki RAM kecil, nilai ini bisa diturunkan, misalnya:

```yaml
mem_limit: 256m
environment:
  NODE_OPTIONS: --max-old-space-size=192
```

Pastikan Docker Desktop atau Docker Engine sudah berjalan sebelum menjalankan perintah `docker compose`.

## Setup Domain dan Nginx Proxy Manager

Contoh setup production:

```text
air.cains.id     -> Next.js app port 3000
air-ws.cains.id  -> WebSocket signaling port 3001
```

DNS:

```text
air.cains.id      A record / CNAME -> server
air-ws.cains.id   A record / CNAME -> server
```

Proxy Host untuk aplikasi utama:

```text
Domain Names: air.cains.id
Scheme: http
Forward Hostname/IP: 127.0.0.1
Forward Port: 3000
SSL Certificate: aktif
Force SSL: ON
```

Proxy Host untuk WebSocket:

```text
Domain Names: air-ws.cains.id
Scheme: http
Forward Hostname/IP: 127.0.0.1
Forward Port: 3001
Websockets Support: ON
SSL Certificate: aktif
Force SSL: ON
```

Jika Nginx Proxy Manager berjalan di Docker atau container terpisah, `127.0.0.1` mungkin mengarah ke container NPM, bukan host Node.js. Gunakan IP host/container yang bisa dijangkau oleh NPM.

## Cara Pakai

1. Buka aplikasi di dua device atau dua browser.
2. Pastikan kedua device bisa mengakses domain aplikasi dan domain WebSocket.
3. Tunggu device lain muncul di radar.
4. Pilih device tujuan untuk mengirim pairing request.
5. Device tujuan menekan accept.
6. Setelah status terhubung, pilih file untuk dikirim.
7. File diterima langsung di browser penerima tanpa disimpan permanen di server.

## Cek Koneksi WebSocket

Aktifkan signaling server:

```text
https://air.cains.id/api/ws
```

Response yang diharapkan:

```json
{
  "status": "WebRTC signaling server running",
  "wsUrl": "wss://air-ws.cains.id"
}
```

Cek port di server:

```bash
ss -ltnp | grep 3001
```

Tes WebSocket dari client:

```bash
npx wscat -c wss://air-ws.cains.id
```

Jika muncul error `WebSocket is closed before the connection is established`, cek hal berikut:

- `air-ws.cains.id` sudah dibuat di DNS
- Proxy Host `air-ws.cains.id` mengarah ke port `3001`, bukan `3000`
- `Websockets Support` aktif di Nginx Proxy Manager
- SSL aktif untuk `air-ws.cains.id`
- Port `3001` sudah listen di server
- App sudah rebuild setelah mengubah `NEXT_PUBLIC_WS_URL`

## Arsitektur

```text
Browser A                 Server                  Browser B
---------                 ------                  ---------
Device name        ->     /api/discover      <-   Device name
WebSocket          <->    Signaling WS       <->  WebSocket
Offer/Answer/ICE   <->    Port 3001          <->  Offer/Answer/ICE
File chunks        <============================> File chunks
                         WebRTC P2P
```

Server tidak menjadi tempat penyimpanan file. Setelah signaling selesai, transfer file dilakukan melalui WebRTC DataChannel.

## Tech Stack

| Komponen | Teknologi |
| --- | --- |
| Framework | Next.js 14 App Router |
| Language | TypeScript |
| UI | React + Tailwind CSS |
| Signaling | WebSocket menggunakan `ws` |
| Transfer File | WebRTC DataChannel |
| Discovery | API route in-memory |

## Catatan

- WebSocket signaling server memakai port terpisah dari Next.js.
- State discovery dan room masih in-memory, sehingga akan reset saat server restart.
- Untuk multi-instance production, signaling dan discovery perlu dipindah ke storage bersama seperti Redis.
- WebRTC pada jaringan tertentu bisa gagal tanpa TURN server, terutama jika kedua peer berada di NAT/firewall ketat.

## License

[MIT](LICENSE)
