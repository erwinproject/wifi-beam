export interface ActiveDevice {
  id: string;
  name: string;
  ip: string;
  lastSeen: number;
  isHost: boolean;
  roomId?: string;
  hasPin?: boolean;
}

export const activeDevices = new Map<string, ActiveDevice>();
