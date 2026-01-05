/**
 * Protoo protocol message classes
 */

export interface ProtooMessage {
  toDict(): Record<string, any>;
  toJson(): string;
}

/**
 * Protoo protocol request message
 */
export class ProtooRequest implements ProtooMessage {
  request: boolean = true;
  method: string;
  id: number;
  data: Record<string, any>;

  constructor(method: string, data: Record<string, any> = {}, requestId?: number) {
    this.method = method;
    // Generate ID based on timestamp (milliseconds) modulo 1000000
    this.id = requestId !== undefined ? requestId : Math.floor(Date.now() % 1000000);
    this.data = data;
  }

  toDict(): Record<string, any> {
    // Match the order from websocket history: data, id, method, request
    return {
      "data": this.data,
      "id": this.id,
      "method": this.method,
      "request": this.request
    };
  }

  toJson(): string {
    return JSON.stringify(this.toDict());
  }
}

/**
 * Protoo protocol notification message
 */
export class ProtooNotification implements ProtooMessage {
  notification: boolean = true;
  method: string;
  data: Record<string, any>;

  constructor(method: string, data: Record<string, any> = {}) {
    this.notification = true;
    this.method = method;
    this.data = data;
  }

  toDict(): Record<string, any> {
    // Match the order from websocket history: data, method, notification
    return {
      "data": this.data,
      "method": this.method,
      "notification": this.notification
    };
  }

  toJson(): string {
    return JSON.stringify(this.toDict());
  }
}

/**
 * Protoo protocol response message
 */
export class ProtooResponse implements ProtooMessage {
  response: boolean = true;
  id: number;
  ok: boolean;
  data: Record<string, any>;

  constructor(responseId: number, ok: boolean, data: Record<string, any> = {}) {
    this.response = true;
    this.id = responseId;
    this.ok = ok;
    this.data = data;
  }

  static fromDict(data: Record<string, any>): ProtooResponse {
    return new ProtooResponse(
      data.id || 0,
      data.ok || false,
      data.data || {}
    );
  }

  toDict(): Record<string, any> {
    return {
      "response": this.response,
      "id": this.id,
      "ok": this.ok,
      "data": this.data
    };
  }

  toJson(): string {
    return JSON.stringify(this.toDict());
  }
}

