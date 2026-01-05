/**
 * Mesh/Room model for Rave API
 */

export interface Mesh {
  id: string;
  server?: string;
  roomId?: string;
  privacyMode?: string;
  playMode?: string;
  voipMode?: string;
  maturity?: string;
}

export interface MeshState {
  url?: string;
  videoUrl?: string;
  videoInstanceId?: string;
  status?: string;
  server?: string;
  time?: number;
  position?: number;
  privacyMode?: string;
  playMode?: string;
  voipMode?: string;
  maturity?: string;
}

export class MeshModel {
  id: string;
  server?: string;
  roomId?: string;
  privacyMode?: string;
  playMode?: string;
  voipMode?: string;
  maturity?: string;

  constructor(data: Partial<Mesh>) {
    this.id = data.id || '';
    this.server = data.server;
    this.roomId = data.roomId || data.id; // room_id is often the same as id
    this.privacyMode = data.privacyMode;
    this.playMode = data.playMode;
    this.voipMode = data.voipMode;
    this.maturity = data.maturity;
  }

  static fromDict(data: Record<string, any>): MeshModel {
    return new MeshModel({
      id: data.id || '',
      server: data.server,
      roomId: data.id, // room_id is often the same as id
      privacyMode: data.privacy_mode,
      playMode: data.play_mode,
      voipMode: data.voip_mode,
      maturity: data.maturity
    });
  }

  toDict(): Record<string, any> {
    const result: Record<string, any> = { id: this.id };
    if (this.server !== undefined) result.server = this.server;
    if (this.roomId !== undefined) result.room_id = this.roomId;
    if (this.privacyMode !== undefined) result.privacy_mode = this.privacyMode;
    if (this.playMode !== undefined) result.play_mode = this.playMode;
    if (this.voipMode !== undefined) result.voip_mode = this.voipMode;
    if (this.maturity !== undefined) result.maturity = this.maturity;
    return result;
  }
}

export class MeshStateModel {
  url?: string;
  videoUrl?: string;
  videoInstanceId?: string;
  status?: string;
  server?: string;
  time?: number;
  position?: number;
  privacyMode?: string;
  playMode?: string;
  voipMode?: string;
  maturity?: string;

  constructor(data: Partial<MeshState> = {}) {
    this.url = data.url;
    this.videoUrl = data.videoUrl;
    this.videoInstanceId = data.videoInstanceId;
    this.status = data.status;
    this.server = data.server;
    this.time = data.time;
    this.position = data.position;
    this.privacyMode = data.privacyMode;
    this.playMode = data.playMode;
    this.voipMode = data.voipMode;
    this.maturity = data.maturity;
  }

  static fromDict(data: Record<string, any>): MeshStateModel {
    return new MeshStateModel({
      url: data.url,
      videoUrl: data.video_url,
      videoInstanceId: data.video_instance_id,
      status: data.status,
      server: data.server,
      time: data.time,
      position: data.position,
      privacyMode: data.privacy_mode,
      playMode: data.play_mode,
      voipMode: data.voip_mode,
      maturity: data.maturity
    });
  }

  toDict(): Record<string, any> {
    const result: Record<string, any> = {};
    if (this.url !== undefined) result.url = this.url;
    if (this.videoUrl !== undefined) result.video_url = this.videoUrl;
    if (this.videoInstanceId !== undefined) result.video_instance_id = this.videoInstanceId;
    if (this.status !== undefined) result.status = this.status;
    if (this.server !== undefined) result.server = this.server;
    if (this.time !== undefined) result.time = this.time;
    if (this.position !== undefined) result.position = this.position;
    if (this.privacyMode !== undefined) result.privacy_mode = this.privacyMode;
    if (this.playMode !== undefined) result.play_mode = this.playMode;
    if (this.voipMode !== undefined) result.voip_mode = this.voipMode;
    if (this.maturity !== undefined) result.maturity = this.maturity;
    return result;
  }
}

