/**
 * Rave Bot Module
 * Discord-like command bot for Rave WebSocket rooms
 */

import { RaveWebSocketClient } from '../websocket/client';
import { CommandContext } from './context';
import { StateMessageModel, UserStateModel } from '../models/state';
import { RaveAPIClient } from '../api/client';
import { getMeshInfo, getUsersList, leaveMesh } from '../utils/helpers';
import { permissionManager } from './permissions';

export type CommandHandler = (ctx: CommandContext) => Promise<void> | void;
export type EventHandler = (...args: any[]) => Promise<void> | void;

export interface MessageInfo {
  message: string;
  senderPeerId: string;
  senderUserId?: number;
  senderName: string;
  messageId: string;
  meshId: string;
  replyTo?: string;
  isReply: boolean;
  isReplyToBot: boolean;
  isMentioned: boolean;
  userMetas: Record<string, any>[];
  rawData: Record<string, any>;
  bot: RaveBot;
}

export interface UserInfo {
  id: number;
  displayName?: string;
  handle?: string;
  name?: string;
}

/**
 * Discord-like command bot for Rave rooms
 */
export class RaveBot {
  server: string;
  roomId: string;
  peerId: string;
  authToken: string;
  deviceId: string;
  commandPrefixes: string[];
  commandPrefix: string;
  debug: boolean;
  botUserId?: number;

  // Command registry
  commands: Map<string, CommandHandler> = new Map();

  // Event registry (event_name -> list of handlers)
  events: Map<string, EventHandler[]> = new Map();

  // WebSocket client
  client?: RaveWebSocketClient;

  // Manager reference (set by BotManager)
  manager?: any;

  // Flag to prevent processing kicked notification multiple times
  private _kickedProcessed: boolean = false;

  // Track current users (set of user IDs)
  currentUserIds: Set<number> = new Set();

  // Flag to track if user list has been initialized from mesh info
  private _usersInitialized: boolean = false;

  // Cache user display names per mesh (user_id -> display_name)
  userNameCache: Map<string, Map<number, string>> = new Map();

  // Track bot's sent message IDs to detect replies
  botMessageIds: Set<string> = new Set();

  // Also track recent message content to match replies (fallback if server changes IDs)
  recentBotMessages: Array<{ id: string; content: string; timestamp: number; videoInfo?: any }> = [];

  // Auto-leave when last user (default: true)
  autoLeaveWhenLast: boolean = true;

  // Flag to track if bot left because it was the last user
  leftBecauseLastUser: boolean = false;

  // Flag to track if server initiated disconnect
  serverDisconnected: boolean = false;

  constructor(
    server: string,
    roomId: string,
    peerId: string,
    authToken: string = "",
    deviceId: string = "",
    commandPrefix: string | string[] = "!",
    debug: boolean = false
  ) {
    /**
     * Initialize Rave Bot
     * 
     * @param server - WebSocket server hostname
     * @param roomId - Mesh room ID
     * @param peerId - Peer ID (required)
     * @param authToken - Bearer token for authentication
     * @param deviceId - Device ID for API operations
     * @param commandPrefix - Prefix for commands (default: "!"). Can be a string or array of strings
     * @param debug - Enable debug logging (default: false)
     */
    this.server = server;
    this.roomId = roomId;
    this.peerId = peerId;
    this.authToken = authToken;
    this.deviceId = deviceId;

    // Support multiple prefixes - convert string to array if needed
    if (typeof commandPrefix === 'string') {
      this.commandPrefixes = [commandPrefix];
    } else {
      this.commandPrefixes = commandPrefix && commandPrefix.length > 0 ? [...commandPrefix] : ["!"];
    }
    // Keep single prefix for backward compatibility
    this.commandPrefix = this.commandPrefixes[0] || "!";
    this.debug = debug;

    // Extract bot's user ID from peer_id (format: {userId}_{uuid})
    try {
      const parts = peerId.split('_');
      if (parts.length > 0) {
        this.botUserId = parseInt(parts[0], 10);
        if (isNaN(this.botUserId)) {
          this.botUserId = undefined;
        }
      }
    } catch {
      this.botUserId = undefined;
    }

    // Register default commands
    this._registerDefaultCommands();
  }

  private _registerDefaultCommands(): void {
    /**Register default commands*/

    this.command("help", async (ctx) => {
      /**Show available commands*/
      // Get primary prefix (first one)
      const primaryPrefix = this.commandPrefixes[0] || "!";
      const otherPrefixes = this.commandPrefixes.length > 1
        ? this.commandPrefixes.slice(1).join(", ")
        : null;

      // Organize commands into categories
      const basicCommands: string[] = [];
      const videoCommands: string[] = [];
      const gameCommands: string[] = [];
      const infoCommands: string[] = [];

      // Categorize commands
      for (const [cmdName, cmdFunc] of this.commands.entries()) {
        // Get doc from function if available (not easily accessible in JS/TS)
        const doc = "No description";
        const cmdLine = `\`${primaryPrefix}${cmdName}\` - ${doc}`;

        // Categorize based on command name
        if (["hello", "ping"].includes(cmdName)) {
          basicCommands.push(cmdLine);
        } else if (["search", "set"].includes(cmdName)) {
          videoCommands.push(cmdLine);
        } else if (["truth", "dare"].includes(cmdName)) {
          gameCommands.push(cmdLine);
        } else {
          infoCommands.push(cmdLine);
        }
      }

      // Build help text
      const helpParts: string[] = ["**📋 Available Commands**"];

      if (otherPrefixes) {
        helpParts.push(`*Prefixes: ${primaryPrefix}, ${otherPrefixes}*\n`);
      } else {
        helpParts.push(`*Prefix: ${primaryPrefix}*\n`);
      }

      if (basicCommands.length > 0) {
        helpParts.push("**Basic Commands:**");
        helpParts.push(...basicCommands);
        helpParts.push("");
      }

      if (videoCommands.length > 0) {
        helpParts.push("**Video Commands:**");
        helpParts.push(...videoCommands);
        helpParts.push("");
      }

      if (gameCommands.length > 0) {
        helpParts.push("**Game Commands:**");
        helpParts.push(...gameCommands);
        helpParts.push("");
      }

      if (infoCommands.length > 0) {
        helpParts.push("**Info Commands:**");
        helpParts.push(...infoCommands);
      }

      const helpText = helpParts.join("\n");
      await ctx.reply(helpText);
    });

    this.command("ping", async (ctx) => {
      /**Check if bot is alive*/
      await ctx.reply("Pong! 🏓");
    });

    this.command("info", async (ctx) => {
      /**Show bot information*/
      const info = `**Bot Info:**\n` +
        `Server: \`${this.server}\`\n` +
        `Room ID: \`${this.roomId.substring(0, 8)}...\`\n` +
        `Commands: \`${this.commands.size}\``;
      await ctx.reply(info);
    });

    this.command("relogin", async (ctx) => {
      /**Relogin and update credentials*/
      await ctx.reply("🔄 Starting relogin process... Please check your email for the magic link.");

      try {
        // Load credentials to get email
        const { loadCredentials } = await import('../auth/credentials');
        const { updateCredentials } = await import('../auth/sync');
        const credentials = await loadCredentials();

        if (!credentials || !credentials.email) {
          await ctx.reply("❌ No credentials found. Cannot relogin.");
          return;
        }

        // Perform login
        const { RaveLogin } = await import('../auth/login');
        const loginClient = new RaveLogin(credentials.email, credentials.deviceId, credentials.ssaid);
        const loginResult = await loginClient.login(true);

        // Strip "r:" or "r: " prefix from tokens before saving
        const stripPrefix = (token?: string) => {
          if (!token) return token;
          if (token.startsWith('r: ')) {
            return token.substring(3);
          } else if (token.startsWith('r:')) {
            return token.substring(2);
          }
          return token;
        };

        // Prepare new credentials with stripped tokens
        const newCredentials = {
          email: credentials.email,
          deviceId: loginResult.deviceId,
          ssaid: loginResult.ssaid,
          parseId: loginResult.parseId,
          parseToken: stripPrefix(loginResult.parseToken),
          authToken: stripPrefix(loginResult.authToken || loginResult.parseToken),
          userId: loginResult.userId,
          peerId: loginResult.peerId
        };

        // Save to both MongoDB and JSON
        await updateCredentials(newCredentials);

        // Update bot's authToken immediately (no restart needed)
        this.authToken = newCredentials.authToken || '';

        // Update WebSocket client's authToken if connected
        if (this.client && typeof (this.client as any).updateAuthToken === 'function') {
          (this.client as any).updateAuthToken(this.authToken);
        } else if (this.client) {
          (this.client as any).authToken = this.authToken;
        }

        // If in a worker process, notify parent to refresh credentials in all workers
        if (process.send) {
          const { createEvent } = await import('../process/ipc');
          process.send(createEvent({
            type: 'credentials_updated',
            credentials: {
              email: newCredentials.email,
              deviceId: newCredentials.deviceId,
              ssaid: newCredentials.ssaid,
              parseId: newCredentials.parseId,
              parseToken: newCredentials.parseToken,
              authToken: newCredentials.authToken || '',
              userId: newCredentials.userId,
              peerId: newCredentials.peerId || ''
            }
          }));
        }

        await ctx.reply("✅ Relogin successful! New credentials saved and active. All bots will use new credentials automatically.");
      } catch (error: any) {
        console.error("Relogin error:", error);
        await ctx.reply(`❌ Relogin failed: ${error.message}`);
      }
    });

    this.command("leave", async (ctx) => {
      /**Leave the mesh and close the process*/
      await ctx.reply("👋 Leaving mesh... Goodbye!");

      try {
        // Create API client with auth token
        const apiClient = new RaveAPIClient("https://api.red.wemesh.ca", this.authToken);

        // Leave the mesh via API
        await leaveMesh(this.roomId, this.deviceId, apiClient);

        // Disconnect WebSocket
        if (this.client) {
          await this.client.disconnect(1000, "User requested leave");
        }

        // If running in a worker process, notify parent and exit
        if (process.send) {
          const { createEvent } = await import('../process/ipc');
          // Notify parent this is an intentional leave, not a crash
          process.send(createEvent({
            type: 'intentional_leave',
            meshId: this.roomId
          }));

          // Give time for the event to be sent and goodbye message to go through
          setTimeout(() => {
            process.exit(0);
          }, 1000);
        }
      } catch (error: any) {
        console.error("Leave error:", error);
        await ctx.reply(`❌ Failed to leave: ${error.message}`);
      }
    });
  }

  command(name: string): (handler: CommandHandler) => CommandHandler;
  command(name: string, handler: CommandHandler): void;
  command(name: string, handler?: CommandHandler): any {
    /**
     * Decorator or method to register a command
     * 
     * Usage:
     *   @bot.command("hello")
     *   async function helloCommand(ctx) {
     *     await ctx.reply("Hello!");
     *   }
     * 
     * Or:
     *   bot.command("hello", async (ctx) => {
     *     await ctx.reply("Hello!");
     *   });
     */
    const cmdName = name.toLowerCase();

    if (handler) {
      // Direct registration
      this.commands.set(cmdName, handler);
      return;
    } else {
      // Decorator pattern
      return (handler: CommandHandler) => {
        this.commands.set(cmdName, handler);
        return handler;
      };
    }
  }

  event(name: string): (handler: EventHandler) => EventHandler;
  event(name: string, handler: EventHandler): void;
  event(name: string, handler?: EventHandler): any {
    /**
     * Decorator or method to register an event handler
     * 
     * Usage:
     *   @bot.event("on_user_join")
     *   async function onUserJoinHandler(bot, userInfo) {
     *     console.log(`User joined: ${userInfo.displayName}`);
     *   }
     */
    const eventName = name.toLowerCase();

    if (handler) {
      // Direct registration
      if (!this.events.has(eventName)) {
        this.events.set(eventName, []);
      }
      this.events.get(eventName)!.push(handler);
      return;
    } else {
      // Decorator pattern
      return (handler: EventHandler) => {
        if (!this.events.has(eventName)) {
          this.events.set(eventName, []);
        }
        this.events.get(eventName)!.push(handler);
        return handler;
      };
    }
  }

  private async _dispatchEvent(eventName: string, ...args: any[]): Promise<void> {
    /**Dispatch an event to all registered handlers*/
    const handlers = this.events.get(eventName.toLowerCase());
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(...args);
        } catch (error: any) {
          console.error(`Error in event handler ${eventName}:`, error);
        }
      }
    }
  }

  async sendMessage(
    text: string,
    replyTo?: string,
    media?: Record<string, any>[],
    userMetas?: Array<{ handle: string; id: number }>
  ): Promise<string | undefined> {
    /**
     * Send a chat message
     * 
     * @param text - Message text to send
     * @param replyTo - Optional message ID to reply to
     * @param media - Optional list of media items to include in message
     * @param userMetas - Optional array of user metadata for tagging/mentions
     * @returns Message ID that was sent
     */
    if (this.client) {
      // Send message and get the ID we sent
      const sentMessageId = await this.client.sendChatMessage(text, undefined, replyTo, media, userMetas);
      // Track the message ID we sent immediately
      if (sentMessageId) {
        this.botMessageIds.add(sentMessageId);
        // Also track message content for fallback matching
        this.recentBotMessages.push({
          id: sentMessageId,
          content: text,
          timestamp: Date.now()
        });
        // Keep only last 50 messages
        if (this.recentBotMessages.length > 50) {
          this.recentBotMessages.shift();
        }
      }
      return sentMessageId;
    }
    return undefined;
  }

  private _parseCommand(message: string): [string, string[]] | null {
    /**
     * Parse a command from a message
     * 
     * @returns [command_name, args] or null if not a command
     */
    // Check if message starts with any of the command prefixes
    let matchedPrefix: string | null = null;
    for (const prefix of this.commandPrefixes) {
      if (message.startsWith(prefix)) {
        matchedPrefix = prefix;
        break;
      }
    }

    if (!matchedPrefix) {
      return null;
    }

    // Remove prefix and split
    const content = message.substring(matchedPrefix.length).trim();
    if (!content) {
      return null;
    }

    // Split command and args
    const parts = content.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    return [command, args];
  }

  private _handleMessage = (data: Record<string, any>): void => {
    /**Handle incoming WebSocket messages (synchronous wrapper)*/
    // Schedule async handler
    setImmediate(() => {
      this._handleMessageAsync(data).catch(error => {
        console.error("Error in message handler:", error);
      });
    });
  };

  private async _handleMessageAsync(data: Record<string, any>): Promise<void> {
    /**Handle incoming WebSocket messages (async implementation)*/
    try {
      // Handle kicked notification
      if (data.notification && data.method === "kicked") {
        // Prevent processing the same kicked notification multiple times
        if (this._kickedProcessed) {
          return;
        }
        this._kickedProcessed = true;
        if (this.manager) {
          const meshId = this.roomId;
          const botInfo = this.manager.bots.get(meshId);
          if (botInfo) {
            botInfo.kicked = true;
          }
        }
        await this._dispatchEvent("on_kicked", {});
        if (this.client) {
          await this.client.disconnect(4003, "kicked");
        }
        return;
      }

      // Handle disconnected notification from server
      if (data.notification && data.method === "disconnected") {
        if (this.debug) {
          console.log("Server sent disconnected notification, closing connection");
        }
        
        // Mark as server-initiated disconnect
        this.serverDisconnected = true;
        
        // Notify parent if in worker process
        if (process.send) {
          const { createEvent } = await import('../process/ipc');
          process.send(createEvent({
            type: 'disconnected',
            reason: 'Server disconnected'
          }));
        }
        
        if (this.client) {
          await this.client.disconnect(1000, "Server disconnected");
        }
        return;
      }

      // Handle stateMessage notifications (user join/leave events)
      // Format: {"notification":true,"method":"stateMessage","data":{"message":"{...json...}"}}
      if (data.notification && data.method === "stateMessage") {
        const messageData = data.data || {};
        const messageStr = messageData.message || "";
        if (messageStr) {
          try {
            const stateData = JSON.parse(messageStr);
            if (stateData.users && stateData.mesh_state !== undefined) {
              await this._handleUserStateUpdate(stateData);
            }
          } catch (error: any) {
            console.error(`Error parsing stateMessage: ${error.message}`);
          }
        }
      }

      // Check if it's a chat message notification
      if (data.notification && data.method === "chatMessage") {
        const messageData = data.data || {};
        const chatText = messageData.chat || "";
        const sender = messageData.from || "";
        const messageId = messageData.id || "";

        // If message is from bot, track its message ID for reply detection
        if (sender === this.peerId) {
          if (messageId) {
            // Track the server's assigned message ID (might be different from what we sent)
            this.botMessageIds.add(messageId);
            // Also match this received ID with any recent sent messages by content
            // This helps if server assigns different ID
            for (const msg of this.recentBotMessages) {
              if (msg.content === chatText && msg.id !== messageId) {
                // Server assigned different ID - map it
                this.botMessageIds.add(messageId);
                // If this message has video_info, also update video_info_map with server-assigned ID
                if (msg.videoInfo && (this as any).videoInfoMap) {
                  (this as any).videoInfoMap[messageId] = msg.videoInfo;
                }
                break;
              }
            }
          }
          return;
        }

        // Extract user ID from sender peer_id (format: {userId}_{uuid})
        let userId: number | undefined;
        try {
          if (sender) {
            const parts = sender.split('_');
            if (parts.length > 0) {
              userId = parseInt(parts[0], 10);
              if (isNaN(userId)) {
                userId = undefined;
              }
            }
          }
        } catch {
          userId = undefined;
        }

        // Parse command
        const parsed = this._parseCommand(chatText);
        if (parsed) {
          const [commandName, args] = parsed;

          // Check if command exists
          const commandHandler = this.commands.get(commandName);
          if (commandHandler) {
            // Create context
            const ctx = new CommandContext(this, data, commandName, args);

            // Check permissions before executing command
            const canExecute = await permissionManager.canExecuteCommand(userId || 0, commandName);
            if (!canExecute) {
              await ctx.reply(`❌ You don't have permission to use this command. This command requires admin access.`);
              return;
            }

            // Execute command
            try {
              await commandHandler(ctx);
            } catch (error: any) {
              console.error(`Error executing command ${commandName}:`, error);
              await ctx.reply(`❌ Error executing command: ${error.message}`);
            }
          }
        } else {
          // Not a command - fire on_message event
          // Get user display name from cache or fetch
          const userName = await this._getUserDisplayName(userId);

          // Extract reply and mentions info
          const replyToMessageId = messageData.reply;
          const userMetas = messageData.user_metas || [];

          // Check if bot is mentioned (user_metas contains bot's user ID)
          // Bot user ID is extracted from peerId (format: {userId}_{uuid})
          let isMentioned = false;
          if (this.botUserId !== undefined && userMetas.length > 0) {
            isMentioned = userMetas.some(
              (meta: any) => {
                if (!meta || typeof meta !== 'object') {
                  return false;
                }
                // Handle both string and number IDs
                const metaId = typeof meta.id === 'string' ? parseInt(meta.id, 10) : meta.id;
                return metaId === this.botUserId;
              }
            );
          }

          if (this.debug && userMetas.length > 0) {
            console.log(`Mention check: botUserId=${this.botUserId}, userMetas=${JSON.stringify(userMetas)}, isMentioned=${isMentioned}`);
          }

          // Check if reply is to a bot message
          let isReplyToBot = false;
          if (replyToMessageId) {
            if (this.botMessageIds.has(replyToMessageId)) {
              isReplyToBot = true;
            } else {
              // Fallback: If we recently sent a message (within last 30 seconds),
              // assume any reply might be to our message (server might use different ID)
              const currentTime = Date.now();
              const recentMessages = this.recentBotMessages.filter(
                msg => currentTime - msg.timestamp < 30000
              );
              if (recentMessages.length > 0) {
                // We sent a message recently, likely this reply is to us
                isReplyToBot = true;
                if (this.debug) {
                  console.log(`Assuming reply to bot (recent message sent, server ID mismatch: ${replyToMessageId})`);
                }
              }
            }
          }

          // Prepare message info for event
          const messageInfo: MessageInfo = {
            message: chatText,
            senderPeerId: sender,
            senderUserId: userId,
            senderName: userName,
            messageId: messageId,
            meshId: this.roomId,
            replyTo: replyToMessageId,
            isReply: replyToMessageId !== undefined && replyToMessageId !== null,
            isReplyToBot: isReplyToBot,
            isMentioned: isMentioned,
            userMetas: userMetas,
            rawData: messageData,
            bot: this
          };

          // Fire on_message event
          await this._dispatchEvent("on_message", messageInfo);

          // Auto-respond with Cloudflare AI if mentioned or replied to bot
          if (isMentioned || isReplyToBot) {
            try {
              const { addUserMessage, getResponse } = await import('../utils/cloudflare_ai');

              // Add user message to thread
              addUserMessage(this.roomId, userName, chatText);

              // Get AI response
              const aiResponse = await getResponse(this.roomId);

              if (aiResponse && aiResponse.trim()) {
                await this.sendMessage(aiResponse, messageId);
              }
            } catch (error: any) {
              console.error(`Error generating AI response:`, error);
              // Don't send error message to user, just log it
            }
          }
        }
      }
    } catch (error: any) {
      console.error(`Error handling message: ${error.message}`);
    }
  };

  private async _initializeUsersFromMeshInfo(): Promise<void> {
    /**Initialize user list from mesh info API (called on connect)*/
    try {
      // Create API client from bot's auth_token
      const apiClient = new RaveAPIClient("https://api.red.wemesh.ca", this.authToken);
      const meshInfo = await getMeshInfo(this.roomId, apiClient);
      const users = meshInfo.users || [];

      // Extract user IDs from the users list
      // Users can be either objects with 'id' key or just user IDs
      const initialUserIds = new Set<number>();
      for (const user of users) {
        let userId: number | undefined;
        if (typeof user === 'object' && user !== null) {
          userId = user.id;
        } else {
          userId = typeof user === 'number' ? user : parseInt(String(user), 10);
        }
        if (userId !== undefined && !isNaN(userId)) {
          initialUserIds.add(userId);
        }
      }

      // Set initial user list (don't fire events for these)
      this.currentUserIds = initialUserIds;
      this._usersInitialized = true;

      // Cache user names if we have full user objects
      if (!this.userNameCache.has(this.roomId)) {
        this.userNameCache.set(this.roomId, new Map());
      }
      const cache = this.userNameCache.get(this.roomId)!;

      for (const user of users) {
        if (typeof user === 'object' && user !== null) {
          const userId = user.id;
          if (userId) {
            const displayName = user.displayName || user.name || user.handle || `User ${userId}`;
            cache.set(parseInt(String(userId), 10), displayName);
          }
        }
      }
    } catch (error: any) {
      console.error(`Error initializing users from mesh info: ${error.message}`);
      // If initialization fails, mark as initialized anyway to prevent spam
      this._usersInitialized = true;
    }
  }

  private async _handleUserStateUpdate(data: Record<string, any>): Promise<void> {
    /**Handle user state updates (join/leave detection)*/
    try {
      const users = data.users || [];
      const currentIds = new Set<number>();
      for (const user of users) {
        const userId = user.user_id;
        if (userId !== undefined && userId !== null) {
          currentIds.add(userId);
        }
      }

      // If users haven't been initialized yet, initialize from this state message
      // (fallback if API call failed)
      if (!this._usersInitialized) {
        this.currentUserIds = currentIds;
        this._usersInitialized = true;
        // Don't fire events for initial users
        return;
      }

      // Detect joins (new user IDs not in previous set)
      const joinedIds: number[] = [];
      for (const id of currentIds) {
        if (!this.currentUserIds.has(id)) {
          joinedIds.push(id);
        }
      }

      // Detect leaves (user IDs in previous set but not in current)
      const leftIds: number[] = [];
      for (const id of this.currentUserIds) {
        if (!currentIds.has(id)) {
          leftIds.push(id);
        }
      }

      // Update current user IDs
      this.currentUserIds = currentIds;

      // Handle joins (only fire events for users who actually joined after initialization)
      if (joinedIds.length > 0) {
        await this._handleUsersJoined(joinedIds);
      }

      // Handle leaves
      if (leftIds.length > 0) {
        await this._handleUsersLeft(leftIds);
      }
    } catch (error: any) {
      console.error(`Error handling user state update: ${error.message}`);
    }
  }

  private async _getUserDisplayName(userId?: number): Promise<string> {
    /**
     * Get user display name, using cache if available, otherwise fetch from API.
     * 
     * @param userId - User ID to get display name for
     * @returns Display name or fallback string
     */
    if (userId === undefined || userId === null) {
      return "Unknown User";
    }

    // Initialize cache for this mesh if needed
    if (!this.userNameCache.has(this.roomId)) {
      this.userNameCache.set(this.roomId, new Map());
    }
    const cache = this.userNameCache.get(this.roomId)!;

    // Check cache first
    if (cache.has(userId)) {
      return cache.get(userId)!;
    }

    // Fetch from API
    try {
      const response = await getUsersList([userId], this.deviceId, true);
      const usersData = response.data || [];

      if (usersData.length > 0) {
        const userInfo = usersData[0];
        const displayName = userInfo.displayName || userInfo.handle || `User ${userId}`;
        // Cache it
        cache.set(userId, displayName);
        return displayName;
      }
    } catch (error: any) {
      console.error(`Error fetching user name for ${userId}: ${error.message}`);
    }

    // Fallback
    const fallbackName = `User ${userId}`;
    cache.set(userId, fallbackName);
    return fallbackName;
  }

  private async _handleUsersJoined(userIds: number[]): Promise<void> {
    /**Handle user joins - use cached data or create minimal user info*/
    if (userIds.length === 0) {
      return;
    }

    // Initialize cache for this mesh if needed
    if (!this.userNameCache.has(this.roomId)) {
      this.userNameCache.set(this.roomId, new Map());
    }
    const cache = this.userNameCache.get(this.roomId)!;

    // Use cached data or create minimal user_info (no API calls)
    for (const userId of userIds) {
      // Get display name from cache if available
      let displayName = cache.get(userId);
      if (!displayName) {
        // Not in cache, use fallback and cache it
        displayName = `User ${userId}`;
        cache.set(userId, displayName);
      }

      // Create user_info from cache
      const userInfo: UserInfo = {
        id: userId,
        displayName: displayName !== `User ${userId}` ? displayName : undefined,
        handle: undefined,
        name: undefined
      };

      // Fire event with cached/minimal info
      await this._dispatchEvent("on_user_join", this, userInfo);
    }
  }

  private async _handleUsersLeft(userIds: number[]): Promise<void> {
    /**Handle user leaves - use cached data or create minimal user info*/
    if (userIds.length === 0) {
      return;
    }

    // Use cached data or create minimal user_info (no API calls)
    for (const userId of userIds) {
      // Get display name from cache if available
      let displayName: string | undefined;
      const cache = this.userNameCache.get(this.roomId);
      if (cache) {
        displayName = cache.get(userId);
      }

      // Create user_info from cache or minimal info
      const userInfo: UserInfo = {
        id: userId,
        displayName: displayName && displayName !== `User ${userId}` ? displayName : undefined,
        handle: undefined,
        name: undefined
      };

      // Fire event with cached/minimal info
      await this._dispatchEvent("on_user_left", userInfo);
    }

    // Check if bot is the last user remaining
    if (this.autoLeaveWhenLast && this.botUserId !== undefined) {
      // Check if only the bot remains
      const remainingUsers = new Set(this.currentUserIds);
      if (remainingUsers.size === 1 && remainingUsers.has(this.botUserId)) {
        this.leftBecauseLastUser = true;
        await this._leaveMesh();
      }
    }
  }

  private async _leaveMesh(): Promise<void> {
    /**Leave the mesh and disconnect*/
    try {
      // Call leave mesh API
      const apiClient = new RaveAPIClient("https://api.red.wemesh.ca", this.authToken);
      await leaveMesh(this.roomId, this.deviceId, apiClient);
    } catch (error: any) {
      console.error(`Error leaving mesh via API: ${error.message}`);
    }

    // Disconnect websocket
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (error: any) {
        console.error(`Error disconnecting from mesh: ${error.message}`);
      }
    }
  }

  async run(): Promise<void> {
    /**Run the bot*/
    // Initialize WebSocket client
    const onConnectedAsync = async () => {
      /**Async handler when bot connects - initialize users then fire on_connected event*/
      // Initialize user list from mesh info first (wait for it to complete)
      await this._initializeUsersFromMeshInfo();
      // Then fire on_connected event
      await this._dispatchEvent("on_connected", this);
    };

    const onConnectedCallback = () => {
      /**Callback when bot connects - initialize users and fire on_connected event*/
      onConnectedAsync().catch(error => {
        console.error("Error in on_connected handler:", error);
      });
    };

    this.client = new RaveWebSocketClient(
      this.server,
      this.roomId,
      this.peerId,
      this.authToken,
      this.debug,
      this._handleMessage,
      onConnectedCallback,
      () => {
        // on_disconnected - do nothing for now
      },
      (error) => {
        console.error(`❌ Bot error: ${error.message}`);
      }
    );

    try {
      // Connect
      const connected = await this.client.connect();
      if (!connected) {
        console.error("Failed to connect bot");
        // Only disconnect if connection failed
        if (this.client) {
          await this.client.disconnect();
        }
        return;
      }

      // Keep running - wait for connection to close
      // The WebSocket client will handle the connection lifecycle
      // We'll wait here until disconnected
      return new Promise<void>((resolve) => {
        // The connection will be closed externally or by disconnect
        // For now, we'll just wait
        // In a real implementation, you might want to use an event emitter
        // or promise that resolves when disconnected
        if (this.client) {
          // Wait for disconnect
          const checkInterval = setInterval(() => {
            if (!this.client || !this.client.connected) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 1000);
        } else {
          resolve();
        }
      });
    } catch (error: any) {
      console.error(`Bot error: ${error.message}`);
      // Only disconnect on error
      if (this.client) {
        await this.client.disconnect();
      }
    }
  }
}

