/**
 * Rave WebSocket Client Module
 * Based on the Android Rave app source code
 * 
 * This module implements the WebSocket connection protocol used by Rave for mesh rooms.
 * It handles connection, keep-alive, join messages, and reconnection logic.
 */

import WebSocket from 'ws';
import * as https from 'https';
import * as http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { ProtooRequest, ProtooNotification, ProtooResponse } from './protoo';

export type MessageCallback = (data: Record<string, any>) => void;
export type ConnectedCallback = () => void;
export type DisconnectedCallback = () => void;
export type ErrorCallback = (error: Error) => void;

/**
 * WebSocket client for Rave mesh rooms
 * 
 * Based on SocketManager.java and RoomClient.java from the Android app.
 */
export class RaveWebSocketClient {
  private server: string;
  private roomId: string;
  private peerId: string;
  private authToken: string;
  private debug: boolean;

  // Callbacks
  private onMessage?: MessageCallback;
  private onConnected?: ConnectedCallback;
  private onDisconnected?: DisconnectedCallback;
  private onError?: ErrorCallback;

  // Connection state
  private websocket: WebSocket | null = null;
  private isConnected: boolean = false;
  private isTerminated: boolean = false;
  private disconnectLock: boolean = false; // Simple lock to prevent race conditions

  // Reconnection strategy (exponential backoff)
  private initialBackoff: number = 1.0; // 1 second
  private maxBackoff: number = 12.5; // 12.5 seconds
  private retryCount: number = 0;
  private maxRetries: number = 10;

  // Ping interval (6 seconds)
  private pingInterval: number = 6000; // 6 seconds in milliseconds
  private pingTimer: NodeJS.Timeout | null = null;
  private listenPromise: Promise<void> | null = null;
  private lastCloseCode: number | null = null;
  private lastCloseReason: string | null = null;
  private connectionStartTime: number = 0;

  // Response channels for request/response pattern
  private responseChannels: Map<number, {
    resolve: (value: Record<string, any>) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  constructor(
    server: string,
    roomId: string,
    peerId: string,
    authToken: string = "",
    debug: boolean = false,
    onMessage?: MessageCallback,
    onConnected?: ConnectedCallback,
    onDisconnected?: DisconnectedCallback,
    onError?: ErrorCallback
  ) {
    /**
     * Initialize Rave WebSocket client
     * 
     * @param server - WebSocket server hostname (e.g., "wss://server.com")
     * @param roomId - Mesh room ID
     * @param peerId - Peer ID (required, format: {userId}_{uuid})
     * @param authToken - Bearer token for authentication
     * @param debug - Enable debug logging (default: false)
     * @param onMessage - Callback for received messages
     * @param onConnected - Callback when connected
     * @param onDisconnected - Callback when disconnected
     * @param onError - Callback for errors
     */
    this.server = server;
    this.roomId = roomId;
    this.peerId = peerId;
    this.authToken = authToken;
    this.debug = debug;
    this.onMessage = onMessage;
    this.onConnected = onConnected;
    this.onDisconnected = onDisconnected;
    this.onError = onError;
  }

  /**
   * Update auth token (for credential refresh without restart)
   */
  updateAuthToken(authToken: string): void {
    this.authToken = authToken;
    if (this.debug) {
      console.log('[WebSocket] Auth token updated');
    }
  }

  private buildUrl(): string {
    /**Build WebSocket URL based on RoomConfig.toProtooUrl()*/
    const params = new URLSearchParams({
      roomId: this.roomId,
      peerId: this.peerId
    });

    // Format: wss://{server}:443/?roomId={roomId}&peerId={peerId}
    let baseUrl = this.server;
    if (!baseUrl.startsWith("wss://") && !baseUrl.startsWith("ws://")) {
      baseUrl = `wss://${baseUrl}`;
    }

    // Ensure port 443 is specified
    if (!baseUrl.includes(":443") && !baseUrl.endsWith(":443")) {
      if (baseUrl.startsWith("wss://")) {
        baseUrl = baseUrl.replace("wss://", "wss://") + ":443";
      } else {
        baseUrl = baseUrl + ":443";
      }
    }

    return `${baseUrl}/?${params.toString()}`;
  }

  private buildHeaders(includeProtocol: boolean = false): Record<string, string> {
    /**Build WebSocket headers as per SocketManager.createRequest()*/
    const headers: Record<string, string> = {
      "API-Version": "4"
    };

    // Only include Authorization header if auth_token is provided
    // Empty headers can cause server rejection
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    // Add Sec-WebSocket-Protocol header if requested
    if (includeProtocol) {
      headers["Sec-WebSocket-Protocol"] = "protoo";
    }

    return headers;
  }

  private createAgent(): https.Agent {
    /**Create HTTPS agent that accepts all certificates (like the app does)*/
    return new https.Agent({
      rejectUnauthorized: false // Accept all certificates
    });
  }

  async connect(): Promise<boolean> {
    /**Connect to WebSocket server*/
    if (this.isConnected) {
      if (this.debug) console.warn("Already connected");
      return true;
    }

    if (this.isTerminated) {
      if (this.debug) console.error("Connection terminated, cannot reconnect");
      return false;
    }

    const url = this.buildUrl();

    if (this.debug) {
      console.log(`Connecting to ${url}`);
    }

    // Build headers
    const headers = this.buildHeaders(false);
    console.log(headers);

    return new Promise((resolve) => {
      try {
        // Create WebSocket with subprotocols
        // The ws library accepts protocols as the second argument
        const options: WebSocket.ClientOptions = {
          headers: headers,
          agent: this.createAgent()
        };

        // Try with subprotocols parameter (second argument is protocols array)
        this.websocket = new WebSocket(url, ["protoo"], options);

        this.websocket.on('open', () => {
          this.isConnected = true;
          this.retryCount = 0; // Reset retry count on successful connection

          if (this.debug) {
            console.log("WebSocket connected successfully");
          }

          // Track connection start time for immediate disconnection detection
          this.connectionStartTime = Date.now();
          this.lastCloseCode = null;
          this.lastCloseReason = null;

          // Start ping task
          this.startPingLoop();

          // Start listen task
          this.startListen();

          // Call on_connected callback
          if (this.onConnected) {
            this.onConnected();
          }

          // Send fullyJoined message after connection
          this.sendFullyJoined().catch(err => {
            if (this.debug) {
              console.error("Error sending fullyJoined:", err);
            }
          });

          resolve(true);
        });

        this.websocket.on('error', (error: Error) => {
          this.isConnected = false;
          
          const errorMsg = error.message.toLowerCase();
          if (errorMsg.includes("timeout") || errorMsg.includes("timed out")) {
            if (this.debug) {
              console.error("Connection failed: timed out during opening handshake");
            }
          } else if (errorMsg.includes("ssl") || errorMsg.includes("certificate")) {
            if (this.debug) {
              console.error(`Connection failed: SSL/TLS error - ${error.message}`);
            }
          } else if (errorMsg.includes("401") || errorMsg.includes("unauthorized")) {
            if (this.debug) {
              console.error(`Connection failed: Authentication error - ${error.message}`);
            }
          } else if (errorMsg.includes("403") || errorMsg.includes("forbidden")) {
            if (this.debug) {
              console.error(`Connection failed: Access forbidden - ${error.message}`);
            }
          } else if (errorMsg.includes("connection refused") || errorMsg.includes("refused")) {
            if (this.debug) {
              console.error("Connection failed: Connection refused - server may be down or unreachable");
            }
          } else if (errorMsg.includes("name resolution") || errorMsg.includes("dns") || errorMsg.includes("getaddrinfo")) {
            if (this.debug) {
              console.error(`Connection failed: DNS resolution error - ${error.message}`);
            }
          } else {
            if (this.debug) {
              console.error(`Connection failed: ${error.message}`);
            }
          }

          if (this.onError) {
            this.onError(error);
          }
          resolve(false);
        });

        this.websocket.on('close', (code: number, reason: Buffer) => {
          if (this.debug) {
            console.log(`WebSocket connection closed: code=${code}, reason=${reason.toString()}`);
          }
          
          // Only update state if not already terminated (to avoid race with disconnect())
          if (!this.isTerminated) {
            this.isConnected = false;
            // Track close code for immediate disconnection detection
            this.lastCloseCode = code;
            this.lastCloseReason = reason.toString();
          }
          
          if (this.onDisconnected) {
            this.onDisconnected();
          }
        });

      } catch (error: any) {
        this.isConnected = false;
        if (this.debug) {
          console.error(`Connection failed: ${error.message}`);
        }
        if (this.onError) {
          this.onError(error);
        }
        resolve(false);
      }
    });
  }

  private startPingLoop(): void {
    /**Send periodic ping messages to keep connection alive (15 second interval)*/
    // Wait for initial interval before first ping (don't send immediately)
    // This matches the app behavior - pings start after connection is established
    setTimeout(() => {
      this.pingTimer = setInterval(() => {
        if (this.isConnected && !this.isTerminated && this.websocket) {
          // Send ping as a request so we can track responses
          // Use sendRequest but don't wait for response (fire and forget with tracking)
          this.sendPingRequest().catch(error => {
            if (this.debug) {
              console.error(`Ping failed: ${error.message}`);
            }
            // Don't stop ping loop on individual ping failures - connection might recover
          });
        } else {
          this.stopPingLoop();
        }
      }, this.pingInterval);
    }, this.pingInterval);
  }

  private async sendPingRequest(): Promise<void> {
    /**Send a ping request and track the response*/
    const pingRequest = new ProtooRequest("clientPing", {});
    
    // Use sendRequest with a shorter timeout for pings (5 seconds)
    // This ensures we track the response but don't block too long
    const response = await this.sendRequest(pingRequest);
    
    if (!response && this.debug) {
      console.warn(`Ping response timeout or failed (id: ${pingRequest.id})`);
    }
  }

  private stopPingLoop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private startListen(): void {
    /**Listen for incoming messages*/
    if (!this.websocket) return;

    this.listenPromise = new Promise<void>((resolve, reject) => {
      this.websocket!.on('message', (data: WebSocket.Data) => {
        try {
          const message = data.toString();
          this.handleMessage(message);
        } catch (error: any) {
          console.error(`Error handling message: ${error.message}`);
          if (this.onError) {
            this.onError(error);
          }
        }
      });

      this.websocket!.on('error', (error: Error) => {
        if (!this.isTerminated) {
          this.isConnected = false;
        }
        if (this.onError) {
          this.onError(error);
        }
        if (this.onDisconnected) {
          this.onDisconnected();
        }
        reject(error);
      });
    });
  }

  private handleMessage(message: string): void {
    /**Handle incoming WebSocket message*/
    try {
      const data = JSON.parse(message);

      // Check if it's a response to a pending request
      if (data.id !== undefined && data.response !== undefined) {
        const requestId = data.id;
        const channel = this.responseChannels.get(requestId);
        if (channel) {
          clearTimeout(channel.timeout);
          this.responseChannels.delete(requestId);
          channel.resolve(data);
          return;
        }
      }

      // Handle notifications and requests from server
      if (this.onMessage) {
        this.onMessage(data);
      }
    } catch (error: any) {
      console.error(`Failed to parse message: ${error.message}`);
    }
  }

  async sendRequest(request: ProtooRequest): Promise<Record<string, any> | null> {
    /**
     * Send a ProtooRequest and wait for response
     * 
     * @param request - ProtooRequest to send
     * @returns Response data or null if error
     */
    // Check both is_connected and is_terminated to prevent race conditions
    if (this.isTerminated || !this.isConnected || !this.websocket) {
      if (this.debug) {
        console.error("Not connected or terminated, cannot send request");
      }
      return null;
    }

    return new Promise((resolve) => {
      try {
        // Create response channel with timeout
        const timeout = setTimeout(() => {
          const channel = this.responseChannels.get(request.id);
          if (channel) {
            this.responseChannels.delete(request.id);
            if (this.debug) {
              console.error(`Request ${request.id} timed out`);
            }
            resolve(null);
          }
        }, 8000); // 8 second timeout

        const channel = {
          resolve: (value: Record<string, any>) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error: Error) => {
            clearTimeout(timeout);
            if (this.debug) {
              console.error(`Request ${request.id} rejected: ${error.message}`);
            }
            resolve(null);
          },
          timeout
        };

        this.responseChannels.set(request.id, channel);

        // Send request
        const message = request.toJson();
        
        // Check again right before sending to catch race conditions
        if (this.isTerminated || !this.isConnected || !this.websocket) {
          this.responseChannels.delete(request.id);
          clearTimeout(timeout);
          resolve(null);
          return;
        }

        this.websocket.send(message);
      } catch (error: any) {
        if (this.debug) {
          console.error(`Error sending request: ${error.message}`);
        }
        const channel = this.responseChannels.get(request.id);
        if (channel) {
          clearTimeout(channel.timeout);
          this.responseChannels.delete(request.id);
        }
        resolve(null);
      }
    });
  }

  async sendNotification(notification: ProtooNotification): Promise<void> {
    /**
     * Send a ProtooNotification (fire and forget)
     * 
     * @param notification - ProtooNotification to send
     */
    // Check both is_connected and is_terminated to prevent race conditions
    if (this.isTerminated || !this.isConnected || !this.websocket) {
      if (this.debug) {
        console.error("Not connected or terminated, cannot send notification");
      }
      return;
    }

    try {
      const message = notification.toJson();
      
      // Check again right before sending to catch race conditions
      if (this.isTerminated || !this.isConnected || !this.websocket) {
        return;
      }

      this.websocket.send(message);
    } catch (error: any) {
      if (this.debug) {
        console.error(`Error sending notification: ${error.message}`);
      }
    }
  }

  async sendFullyJoined(): Promise<void> {
    /**Send fullyJoined request after connection (as per RoomClient.sendFullyJoined)*/
    const request = new ProtooRequest("fullyJoined", {});
    const response = await this.sendRequest(request);
    if (response) {
      if (this.debug) {
        console.log("fullyJoined response received");
      }
    } else if (this.debug) {
      console.warn("fullyJoined request failed or timed out");
    }
  }

  async sendChatMessage(
    message: string,
    userId?: string,
    replyTo?: string,
    media?: Record<string, any>[]
  ): Promise<string> {
    /**
     * Send a chat message
     * 
     * @param message - Chat message text
     * @param userId - Optional user ID
     * @param replyTo - Optional message ID to reply to
     * @param media - Optional list of media items to include in message
     * @returns Message ID that was sent (may be different from server's assigned ID)
     */
    // Based on history: {"data":{"chat":"...","detected_lang":"en","id":"...","reply":"...","translations":{},"media":[...]},"method":"chatMessage","notification":true}
    const messageId = uuidv4();
    const data: Record<string, any> = {
      chat: message,
      detected_lang: "en", // Could be detected, but defaulting to "en"
      id: messageId,
      translations: {}
    };
    
    if (userId) {
      data.userId = userId;
    }
    if (replyTo) {
      data.reply = replyTo;
    }
    if (media) {
      data.media = media;
    }

    const notification = new ProtooNotification("chatMessage", data);
    await this.sendNotification(notification);
    return messageId;
  }

  async sendTypingState(isTyping: boolean): Promise<void> {
    /**
     * Send typing state notification
     * 
     * @param isTyping - True if user is typing
     */
    // Based on history: "typing" or "typing_stop" (not "userTyping"/"userStoppedTyping")
    const method = isTyping ? "typing" : "typing_stop";
    const notification = new ProtooNotification(method, {});
    await this.sendNotification(notification);
  }

  async disconnect(code: number = 1000, reason: string = "Normal closure"): Promise<void> {
    /**Disconnect from WebSocket*/
    // Use lock to make disconnect atomic and prevent race conditions
    if (this.disconnectLock) {
      return;
    }
    this.disconnectLock = true;

    // Make idempotent - if already terminated, return early
    if (this.isTerminated) {
      this.disconnectLock = false;
      return;
    }

    // Set is_connected to False IMMEDIATELY to prevent any sends
    this.isConnected = false;
    this.isTerminated = true;

    // Stop ping loop
    this.stopPingLoop();

    // Close WebSocket
    if (this.websocket) {
      try {
        this.websocket.close(code, reason);
      } catch (error: any) {
        if (this.debug) {
          console.error(`Error closing WebSocket: ${error.message}`);
        }
      } finally {
        this.websocket = null;
      }
    }

    // Clear all pending response channels
    for (const [id, channel] of this.responseChannels.entries()) {
      clearTimeout(channel.timeout);
      channel.reject(new Error("Connection closed"));
    }
    this.responseChannels.clear();

    this.disconnectLock = false;

    if (this.debug) {
      console.log("Disconnected from WebSocket");
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }

  get terminated(): boolean {
    return this.isTerminated;
  }

  /**
   * Check if the connection was closed immediately after connecting
   * This usually indicates a permanent rejection (invalid auth, no access, etc.)
   */
  wasClosedImmediately(): boolean {
    if (this.lastCloseCode === null || this.connectionStartTime === 0) {
      return false;
    }
    const connectionDuration = Date.now() - this.connectionStartTime;
    // If connection closed within 5 seconds, consider it immediate
    return connectionDuration < 5000;
  }

  getLastCloseCode(): number | null {
    return this.lastCloseCode;
  }

  getLastCloseReason(): string | null {
    return this.lastCloseReason;
  }
}

