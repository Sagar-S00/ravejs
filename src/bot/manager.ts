/**
 * Rave Bot Manager Module
 * Manages multiple RaveBot instances for multiple meshes
 */

import { RaveBot, CommandHandler, EventHandler } from './bot';
import { getMeshes, getMeshInfo, leaveMesh, deleteAllInvites } from '../utils/helpers';
import { RaveAPIClient } from '../api/client';

export enum BotState {
  INITIALIZING = "initializing",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  RETRYING = "retrying",
  FAILED = "failed",
  STOPPED = "stopped"
}

export interface BotInfo {
  meshId: string;
  meshData: Record<string, any>;
  bot?: RaveBot;
  state: BotState;
  retryCount: number;
  retryTimeout?: NodeJS.Timeout;
  runPromise?: Promise<void>;
  monitorInterval?: NodeJS.Timeout;
  kicked: boolean;
}

export interface BotStatus {
  isRunning: boolean;
  totalBots: number;
  bots: Record<string, {
    state: string;
    retryCount: number;
    meshId: string;
  }>;
}

/**
 * Manages multiple RaveBot instances for multiple meshes
 * 
 * Automatically fetches invited meshes and creates bot instances for each.
 * Handles connection failures with automatic retry.
 */
export class BotManager {
  deviceId: string;
  peerId: string;
  authToken: string;
  commandPrefix: string | string[];
  debug: boolean;
  apiClient: RaveAPIClient;
  maxRetries: number;
  retryInitialBackoff: number;
  retryMaxBackoff: number;
  discoveryInterval: number;
  meshMode: string;

  // Bot registry: mesh_id -> BotInfo
  bots: Map<string, BotInfo> = new Map();

  // Global commands and events (applied to all bots)
  globalCommands: Map<string, CommandHandler> = new Map();
  globalEvents: Map<string, EventHandler[]> = new Map();

  // Running state
  isRunning: boolean = false;
  private shutdownRequested: boolean = false;
  private discoveryIntervalId?: NodeJS.Timeout;
  private emptyCheckIntervalId?: NodeJS.Timeout;
  private limit: number = 20;
  private lang: string = "en";
  private credentialsPath?: string;

  constructor(
    deviceId: string,
    peerId: string,
    authToken: string = "",
    commandPrefix: string | string[] = "!",
    debug: boolean = false,
    apiClient?: RaveAPIClient,
    maxRetries: number = 10,
    retryInitialBackoff: number = 1.0,
    retryMaxBackoff: number = 60.0,
    discoveryInterval: number = 60.0,
    meshMode: string = "invited",
    credentialsPath?: string
  ) {
    /**
     * Initialize Bot Manager
     * 
     * @param deviceId - Device ID (required)
     * @param peerId - Peer ID (required, format: {userId}_{uuid})
     * @param authToken - Bearer token for authentication
     * @param commandPrefix - Prefix for commands (default: "!")
     * @param debug - Enable debug logging (default: false)
     * @param apiClient - Optional API client instance
     * @param maxRetries - Maximum retry attempts per bot (default: 10)
     * @param retryInitialBackoff - Initial retry backoff in seconds (default: 1.0)
     * @param retryMaxBackoff - Maximum retry backoff in seconds (default: 60.0)
     * @param discoveryInterval - Interval in seconds to check for new/removed meshes (default: 60.0)
     * @param meshMode - "invited" for only invited meshes, "all" for public + friends + invited (default: "invited")
     * @param credentialsPath - Optional path to credentials file
     */
    this.deviceId = deviceId;
    this.peerId = peerId;
    this.authToken = authToken;
    this.commandPrefix = commandPrefix;
    this.debug = debug;
    this.apiClient = apiClient || new RaveAPIClient("https://api.red.wemesh.ca", authToken);
    this.maxRetries = maxRetries;
    this.retryInitialBackoff = retryInitialBackoff;
    this.retryMaxBackoff = retryMaxBackoff;
    this.discoveryInterval = discoveryInterval;
    this.meshMode = meshMode;
    this.credentialsPath = credentialsPath;
  }

  /**
   * Load credentials from file and update manager
   * 
   * @param credentialsPath - Optional path to credentials file (uses default if not provided)
   * @returns True if credentials were loaded, false otherwise
   */
  async loadCredentials(credentialsPath?: string): Promise<boolean> {
    try {
      const { loadCredentials } = await import('../auth/credentials');
      const path = credentialsPath || this.credentialsPath;
      const credentials = await loadCredentials(path);
      
      if (credentials) {
        this.deviceId = credentials.deviceId;
        this.peerId = credentials.peerId || this.peerId;
        this.authToken = credentials.authToken || credentials.parseToken || this.authToken;
        this.apiClient = new RaveAPIClient("https://api.red.wemesh.ca", this.authToken);
        return true;
      }
      
      return false;
    } catch (error: any) {
      console.error(`Error loading credentials: ${error.message}`);
      return false;
    }
  }

  /**
   * Relogin and update all bots with new credentials
   * 
   * This will:
   * 1. Load email from saved credentials
   * 2. Perform complete login flow
   * 3. Save new credentials
   * 4. Update manager's deviceId, peerId, and authToken
   * 5. Recreate all bot instances with new credentials
   */
  async relogin(): Promise<void> {
    try {
      // Load credentials to get email
      const { loadCredentials, saveCredentials } = await import('../auth/credentials');
      const path = this.credentialsPath;
      const credentials = await loadCredentials(path);
      
      if (!credentials || !credentials.email) {
        throw new Error("No credentials found. Cannot relogin.");
      }
      
      console.log(`[Relogin] Starting relogin for ${credentials.email}...`);
      
      // Perform login
      const { RaveLogin } = await import('../auth/login');
      const loginClient = new RaveLogin(credentials.email, credentials.deviceId, credentials.ssaid);
      const loginResult = await loginClient.login(true);
      
      // Save new credentials
      const newCredentials = {
        email: credentials.email,
        deviceId: loginResult.deviceId,
        ssaid: loginResult.ssaid,
        parseId: loginResult.parseId,
        parseToken: loginResult.parseToken,
        authToken: loginResult.authToken,
        userId: loginResult.userId,
        peerId: loginResult.peerId
      };
      
      await saveCredentials(newCredentials, path);
      console.log(`[Relogin] New credentials saved.`);
      
      // Update manager properties
      this.deviceId = loginResult.deviceId;
      this.peerId = loginResult.peerId || this.peerId;
      this.authToken = loginResult.authToken || loginResult.parseToken;
      this.apiClient = new RaveAPIClient("https://api.red.wemesh.ca", this.authToken);
      
      console.log(`[Relogin] Manager credentials updated.`);
      
      // Recreate all bot instances with new credentials
      const meshIds = Array.from(this.bots.keys());
      for (const meshId of meshIds) {
        const botInfo = this.bots.get(meshId);
        if (!botInfo) continue;
        
        // Stop old bot
        if (botInfo.bot && botInfo.bot.client) {
          try {
            await botInfo.bot.client.disconnect();
          } catch (error: any) {
            // Ignore disconnect errors
          }
        }
        
        // Cancel monitor interval
        if (botInfo.monitorInterval) {
          clearInterval(botInfo.monitorInterval);
          botInfo.monitorInterval = undefined;
        }
        
        // Update bot info
        botInfo.bot = undefined;
        botInfo.state = BotState.INITIALIZING;
        botInfo.retryCount = 0;
        
        // Start bot with new credentials
        try {
          await this._startBot(botInfo);
        } catch (error: any) {
          console.error(`[Relogin] Error restarting bot for mesh ${meshId}:`, error);
        }
      }
      
      console.log(`[Relogin] All bots updated with new credentials.`);
    } catch (error: any) {
      console.error(`[Relogin] Error during relogin:`, error);
      throw error;
    }
  }

  async fetchMeshes(limit: number = 20, lang: string = "en"): Promise<Record<string, any>[]> {
    /**
     * Fetch meshes from API based on mesh_mode
     * 
     * @param limit - Maximum number of meshes to fetch (default: 20)
     * @param lang - Language code (default: "en")
     * @returns List of mesh data dictionaries
     */
    try {
      const response = await getMeshes(
        this.deviceId,
        this.meshMode,
        limit,
        lang,
        undefined,
        this.apiClient
      );
      return response.data || [];
    } catch (error: any) {
      const errorMsg = String(error).toLowerCase();
      const errorType = error.constructor?.name || "";
      const isNetwork = errorMsg.includes("getaddrinfo") ||
        errorMsg.includes("name resolution") ||
        errorMsg.includes("dns") ||
        errorType.includes("ConnectionError") ||
        errorMsg.includes("connection");

      // Log network errors more concisely
      if (isNetwork) {
        console.error(`Failed to fetch meshes (network error): ${String(error).substring(0, 200)}`);
      } else {
        console.error(`Failed to fetch meshes:`, error);
      }
      return [];
    }
  }

  async fetchInvitedMeshes(limit: number = 20, lang: string = "en"): Promise<Record<string, any>[]> {
    /**Deprecated: Use fetchMeshes instead*/
    return this.fetchMeshes(limit, lang);
  }

  private _createBotForMesh(meshId: string, server: string, meshData: Record<string, any>): RaveBot {
    /**
     * Create a RaveBot instance for a mesh
     * 
     * @param meshId - Mesh ID
     * @param server - WebSocket server hostname
     * @param meshData - Full mesh data dictionary
     * @returns RaveBot instance
     */
    const bot = new RaveBot(
      server,
      meshId,
      this.peerId,
      this.authToken,
      this.deviceId,
      this.commandPrefix,
      this.debug
    );

    // Set manager reference
    bot.manager = this;

    // Register global commands
    for (const [cmdName, cmdFunc] of this.globalCommands.entries()) {
      bot.command(cmdName, cmdFunc);
    }

    // Register global events
    for (const [eventName, handlers] of this.globalEvents.entries()) {
      for (const handler of handlers) {
        bot.event(eventName, handler);
      }
    }

    return bot;
  }

  /**
   * Update bot credentials (used after relogin)
   * Updates deviceId, peerId, and authToken for all bots
   */
  updateBotCredentials(deviceId: string, peerId: string, authToken: string): void {
    this.deviceId = deviceId;
    this.peerId = peerId;
    this.authToken = authToken;
    this.apiClient = new RaveAPIClient("https://api.red.wemesh.ca", authToken);
  }

  private async _startBot(botInfo: BotInfo): Promise<void> {
    /**
     * Start a bot instance and handle connection lifecycle
     * 
     * @param botInfo - BotInfo instance to start
     */
    const meshId = botInfo.meshId;
    const meshData = botInfo.meshData;

    try {
      // Get mesh info to extract server
      const meshInfo = await getMeshInfo(meshId, this.apiClient);
      const server = meshInfo.server;

      if (!server) {
        console.error(`No server found for mesh ${meshId}`);
        botInfo.state = BotState.FAILED;
        return;
      }

      // Create bot instance
      botInfo.bot = this._createBotForMesh(meshId, server, meshData);
      botInfo.state = BotState.CONNECTING;

      // Start connection monitoring
      this._startBotMonitoring(botInfo);

      // Run bot (this will connect and listen)
      botInfo.runPromise = this._runBotWithRetry(botInfo);
    } catch (error: any) {
      console.error(`Failed to start bot for mesh ${meshId}:`, error);
      botInfo.state = BotState.FAILED;
    }
  }

  private _startBotMonitoring(botInfo: BotInfo): void {
    /**
     * Monitor bot connection state
     * 
     * @param botInfo - BotInfo instance to monitor
     */
    botInfo.monitorInterval = setInterval(() => {
      if (this.shutdownRequested) {
        if (botInfo.monitorInterval) {
          clearInterval(botInfo.monitorInterval);
          botInfo.monitorInterval = undefined;
        }
        return;
      }

      if (botInfo.bot && botInfo.bot.client) {
        if (botInfo.bot.client.connected) {
          if (botInfo.state !== BotState.CONNECTED) {
            botInfo.state = BotState.CONNECTED;
            botInfo.retryCount = 0; // Reset retry count on successful connection
          }
        } else if (botInfo.state === BotState.CONNECTED) {
          // Was connected but now disconnected
          botInfo.state = BotState.DISCONNECTED;

          // If bot disconnected because it was the last user, remove it from registry
          // (don't retry in this case)
          if (!botInfo.bot.client.connected && botInfo.bot.leftBecauseLastUser) {
            // Mark as stopped so it won't retry
            botInfo.state = BotState.STOPPED;
            // Cancel run promise
            if (botInfo.runPromise) {
              // Promise will resolve naturally
            }
            // Remove from registry
            this.bots.delete(botInfo.meshId);
            if (botInfo.monitorInterval) {
              clearInterval(botInfo.monitorInterval);
              botInfo.monitorInterval = undefined;
            }
          }
        }
      }
    }, 2000); // Check every 2 seconds
  }

  private async _runBotWithRetry(botInfo: BotInfo): Promise<void> {
    /**
     * Run a bot with automatic retry on failure
     * 
     * @param botInfo - BotInfo instance to run
     */
    const meshId = botInfo.meshId;

    while (!this.shutdownRequested && botInfo.retryCount < this.maxRetries) {
      try {
        if (!botInfo.bot) {
          // Need to recreate bot
          const meshData = botInfo.meshData;
          const meshInfo = await getMeshInfo(meshId, this.apiClient);
          const server = meshInfo.server;

          if (!server) {
            console.error(`No server found for mesh ${meshId}`);
            botInfo.state = BotState.FAILED;
            break;
          }

          botInfo.bot = this._createBotForMesh(meshId, server, meshData);
          botInfo.state = BotState.CONNECTING;

          // Start connection monitoring if not already running
          if (!botInfo.monitorInterval) {
            this._startBotMonitoring(botInfo);
          }
        }

        botInfo.state = BotState.CONNECTING;

        // Run bot (this blocks until disconnect)
        await botInfo.bot.run();

        // If we get here, bot disconnected
        botInfo.state = BotState.DISCONNECTED;

        // Check if bot was kicked or left because it was the last user - don't retry in these cases
        if (botInfo.kicked || botInfo.bot.leftBecauseLastUser) {
          botInfo.state = BotState.STOPPED;
          // Remove from registry
          this.bots.delete(meshId);
          break;
        }

        // Check if connection was closed immediately (likely permanent rejection)
        if (botInfo.bot.client && botInfo.bot.client.wasClosedImmediately()) {
          const closeCode = botInfo.bot.client.getLastCloseCode();
          const closeReason = botInfo.bot.client.getLastCloseReason();
          console.error(`Connection to mesh ${meshId} was closed immediately (code: ${closeCode}, reason: ${closeReason}). This likely indicates a permanent rejection (invalid auth, no access, etc.). Stopping retries.`);
          botInfo.state = BotState.FAILED;
          // Remove from registry to prevent retries
          this.bots.delete(meshId);
          break;
        }

        // Check if we should retry
        if (this.shutdownRequested) {
          break;
        }

        if (botInfo.retryCount >= this.maxRetries) {
          console.error(`Max retries reached for mesh ${meshId}`);
          botInfo.state = BotState.FAILED;
          break;
        }

        // Schedule retry
        botInfo.state = BotState.RETRYING;
        botInfo.retryCount++;
        const backoff = Math.min(
          this.retryInitialBackoff * Math.pow(1.5, botInfo.retryCount),
          this.retryMaxBackoff
        );

        await new Promise(resolve => setTimeout(resolve, backoff * 1000));

        // Clean up old bot
        if (botInfo.bot) {
          try {
            if (botInfo.bot.client) {
              await botInfo.bot.client.disconnect();
            }
          } catch {
            // Ignore errors during cleanup
          }
          botInfo.bot = undefined;
        }
      } catch (error: any) {
        const errorMsg = String(error).toLowerCase();
        const errorType = error.constructor?.name || "";

        // Detect different types of network errors
        const isTimeout = errorMsg.includes("timeout") || errorMsg.includes("timed out");
        const isDns = errorMsg.includes("getaddrinfo") ||
          errorMsg.includes("name resolution") ||
          errorMsg.includes("dns") ||
          errorType.includes("NameResolutionError");
        const isConnection = errorType.includes("ConnectionError") || errorMsg.includes("connection");
        const isNetwork = isDns || isConnection || errorMsg.includes("network");

        // Log network errors more concisely (without full traceback)
        if (isNetwork) {
          console.error(`Network error for mesh ${meshId}: ${String(error).substring(0, 200)}`);
        } else {
          console.error(`Error running bot for mesh ${meshId}:`, error);
        }

        botInfo.state = BotState.DISCONNECTED;

        if (botInfo.retryCount >= this.maxRetries) {
          botInfo.state = BotState.FAILED;
          break;
        }

        // Schedule retry
        botInfo.state = BotState.RETRYING;
        botInfo.retryCount++;

        // Use longer backoff for network errors (DNS/connection issues take longer to recover)
        let baseBackoff: number;
        if (isDns) {
          // DNS errors need much longer backoff - network is likely down
          baseBackoff = this.retryInitialBackoff * 5;
        } else if (isTimeout || isConnection) {
          // Timeout/connection errors need longer backoff
          baseBackoff = this.retryInitialBackoff * 2;
        } else {
          baseBackoff = this.retryInitialBackoff;
        }

        const backoff = Math.min(
          baseBackoff * Math.pow(1.5, botInfo.retryCount),
          this.retryMaxBackoff
        );

        await new Promise(resolve => setTimeout(resolve, backoff * 1000));

        // Clean up old bot
        if (botInfo.bot) {
          try {
            if (botInfo.bot.client) {
              await botInfo.bot.client.disconnect();
            }
          } catch {
            // Ignore errors during cleanup
          }
          botInfo.bot = undefined;
        }
      }
    }

    if (botInfo.retryCount >= this.maxRetries) {
      botInfo.state = BotState.FAILED;
      console.error(`Failed to connect to mesh ${meshId} after ${this.maxRetries} attempts`);
    }

    // Cancel monitor task
    if (botInfo.monitorInterval) {
      clearInterval(botInfo.monitorInterval);
      botInfo.monitorInterval = undefined;
    }
  }

  private async _stopBot(botInfo: BotInfo): Promise<void> {
    /**
     * Stop and remove a bot instance
     * 
     * @param botInfo - BotInfo instance to stop
     */
    // Cancel monitor task
    if (botInfo.monitorInterval) {
      clearInterval(botInfo.monitorInterval);
      botInfo.monitorInterval = undefined;
    }

    // Disconnect bot
    if (botInfo.bot && botInfo.bot.client) {
      try {
        await botInfo.bot.client.disconnect();
      } catch {
        // Ignore errors during disconnect
      }
    }

    botInfo.state = BotState.STOPPED;
  }

  private async _syncMeshes(meshesData: Record<string, any>[]): Promise<void> {
    /**
     * Sync bot instances with current invited meshes
     * 
     * Starts new bots for new meshes and stops bots for removed meshes.
     * 
     * @param meshesData - List of current invited mesh data
     */
    // Extract mesh IDs from current invited meshes
    const currentMeshIds = new Set<string>();
    const meshDataMap = new Map<string, Record<string, any>>();

    for (const meshEntry of meshesData) {
      const mesh = meshEntry.mesh || {};
      const meshId = mesh.id;
      if (meshId) {
        currentMeshIds.add(meshId);
        meshDataMap.set(meshId, meshEntry);
      }
    }

    // Find meshes that need to be added (new invites)
    const existingMeshIds = new Set(this.bots.keys());
    const newMeshIds: string[] = [];
    for (const id of currentMeshIds) {
      if (!existingMeshIds.has(id)) {
        newMeshIds.push(id);
      }
    }

    // Find meshes that need to be removed (no longer invited)
    const removedMeshIds: string[] = [];
    for (const id of existingMeshIds) {
      if (!currentMeshIds.has(id)) {
        removedMeshIds.push(id);
      }
    }

    // Start new bots with rate limiting (delay between each start)
    for (let idx = 0; idx < newMeshIds.length; idx++) {
      const meshId = newMeshIds[idx];
      const meshData = meshDataMap.get(meshId);
      if (meshData) {
        const botInfo: BotInfo = {
          meshId: meshId,
          meshData: meshData,
          state: BotState.INITIALIZING,
          retryCount: 0,
          kicked: false
        };
        this.bots.set(meshId, botInfo);
        // Add delay between starting bots to avoid connection floods
        if (idx > 0) {
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
        }
        // Start bot asynchronously
        this._startBot(botInfo).catch(error => {
          console.error(`Error starting bot for mesh ${meshId}:`, error);
        });
      }
    }

    // Stop removed bots
    for (const meshId of removedMeshIds) {
      const botInfo = this.bots.get(meshId);
      if (botInfo) {
        await this._stopBot(botInfo);
        this.bots.delete(meshId);
      }
    }
  }

  private _discoveryLoop(): void {
    /**
     * Periodic discovery loop that checks for new/removed meshes every minute
     */
    // Wait for initial sync to complete before starting periodic checks
    setTimeout(() => {
      this._doDiscovery();
    }, this.discoveryInterval * 1000);
  }

  private async _doDiscovery(): Promise<void> {
    if (this.shutdownRequested) {
      return;
    }

    try {
      // Fetch current invited meshes
      const meshesData = await this.fetchInvitedMeshes(this.limit, this.lang);

      // Sync bots with current meshes
      await this._syncMeshes(meshesData);
    } catch (error: any) {
      console.error(`Error in discovery loop:`, error);
    }

    // Schedule next discovery
    if (!this.shutdownRequested) {
      this.discoveryIntervalId = setTimeout(() => {
        this._doDiscovery();
      }, this.discoveryInterval * 1000);
    }
  }

  private _emptyMeshCheckLoop(): void {
    /**Periodic check to leave empty meshes (every 3 minutes)*/
    setTimeout(() => {
      this._doEmptyMeshCheck();
    }, 180 * 1000); // Wait 3 minutes before first check
  }

  private async _doEmptyMeshCheck(): Promise<void> {
    if (this.shutdownRequested) {
      return;
    }

    try {
      for (const [meshId, botInfo] of Array.from(this.bots.entries())) {
        if (botInfo.kicked) {
          continue;
        }

        if (botInfo.bot && botInfo.state === BotState.CONNECTED) {
          try {
            const meshInfo = await getMeshInfo(meshId, this.apiClient);
            const users = meshInfo.users || [];

            if (users.length === 1) {
              const user = users[0];
              const userId = typeof user === 'object' ? user.id : String(user);
              const peerIdParts = this.peerId.split("_");
              const botUserId = peerIdParts.length > 0 ? peerIdParts[0] : null;

              if (String(userId) === String(botUserId)) {
                await leaveMesh(meshId, this.deviceId, this.apiClient);
                await this._stopBot(botInfo);
                this.bots.delete(meshId);
              }
            }
          } catch {
            // Ignore errors
          }
        }
      }
    } catch {
      // Ignore errors
    }

    // Schedule next check
    if (!this.shutdownRequested) {
      this.emptyCheckIntervalId = setTimeout(() => {
        this._doEmptyMeshCheck();
      }, 180 * 1000); // Check every 3 minutes
    }
  }

  async start(limit: number = 20, lang: string = "en"): Promise<void> {
    /**
     * Start the bot manager
     * 
     * Fetches invited meshes and starts bot instances for each.
     * Also starts periodic discovery task.
     * 
     * @param limit - Maximum number of meshes to fetch (default: 20)
     * @param lang - Language code (default: "en")
     */
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.shutdownRequested = false;
    this.limit = limit;
    this.lang = lang;

    // Delete all existing invites before starting
    console.log('[BotManager] Deleting all existing invites...');
    const deletedCount = await deleteAllInvites(this.deviceId, this.apiClient);
    if (deletedCount > 0) {
      console.log(`[BotManager] Deleted ${deletedCount} invites from existing meshes`);
    } else {
      console.log('[BotManager] No existing invites to delete');
    }

    // Fetch invited meshes
    const meshesData = await this.fetchInvitedMeshes(limit, lang);

    // Sync bots with initial meshes
    await this._syncMeshes(meshesData);

    // Start periodic discovery task
    this._discoveryLoop();

    // Start empty mesh check task
    this._emptyMeshCheckLoop();
  }

  async stop(): Promise<void> {
    /**Stop all bot instances*/
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.shutdownRequested = true;

    // Stop discovery task
    if (this.discoveryIntervalId) {
      clearTimeout(this.discoveryIntervalId);
      this.discoveryIntervalId = undefined;
    }

    // Stop empty check task
    if (this.emptyCheckIntervalId) {
      clearTimeout(this.emptyCheckIntervalId);
      this.emptyCheckIntervalId = undefined;
    }

    // Stop all bots
    for (const [meshId, botInfo] of Array.from(this.bots.entries())) {
      await this._stopBot(botInfo);
    }
  }

  command(name: string): (handler: CommandHandler) => CommandHandler;
  command(name: string, handler: CommandHandler): void;
  command(name: string, handler?: CommandHandler): any {
    /**
     * Decorator or method to register a command for all bots
     * 
     * Usage:
     *   @manager.command("hello")
     *   async function helloCommand(ctx) {
     *     await ctx.reply("Hello!");
     *   }
     */
    const cmdName = name.toLowerCase();

    if (handler) {
      // Direct registration
      this.globalCommands.set(cmdName, handler);
      // Also register for existing bots
      for (const botInfo of this.bots.values()) {
        if (botInfo.bot) {
          botInfo.bot.command(cmdName, handler);
        }
      }
      return;
    } else {
      // Decorator pattern
      return (handler: CommandHandler) => {
        this.globalCommands.set(cmdName, handler);
        // Also register for existing bots
        for (const botInfo of this.bots.values()) {
          if (botInfo.bot) {
            botInfo.bot.command(cmdName, handler);
          }
        }
        return handler;
      };
    }
  }

  event(name: string): (handler: EventHandler) => EventHandler;
  event(name: string, handler: EventHandler): void;
  event(name: string, handler?: EventHandler): any {
    /**
     * Decorator or method to register an event handler for all bots
     * 
     * Usage:
     *   @manager.event("on_user_join")
     *   async function onUserJoinHandler(bot, userInfo) {
     *     console.log(`User joined: ${userInfo.displayName}`);
     *   }
     */
    const eventName = name.toLowerCase();

    if (handler) {
      // Direct registration
      if (!this.globalEvents.has(eventName)) {
        this.globalEvents.set(eventName, []);
      }
      this.globalEvents.get(eventName)!.push(handler);
      // Also register for existing bots
      for (const botInfo of this.bots.values()) {
        if (botInfo.bot) {
          botInfo.bot.event(eventName, handler);
        }
      }
      return;
    } else {
      // Decorator pattern
      return (handler: EventHandler) => {
        if (!this.globalEvents.has(eventName)) {
          this.globalEvents.set(eventName, []);
        }
        this.globalEvents.get(eventName)!.push(handler);
        // Also register for existing bots
        for (const botInfo of this.bots.values()) {
          if (botInfo.bot) {
            botInfo.bot.event(eventName, handler);
          }
        }
        return handler;
      };
    }
  }

  getStatus(): BotStatus {
    /**
     * Get status of all bots
     * 
     * @returns Dictionary with status information
     */
    const status: BotStatus = {
      isRunning: this.isRunning,
      totalBots: this.bots.size,
      bots: {}
    };

    for (const [meshId, botInfo] of this.bots.entries()) {
      status.bots[meshId] = {
        state: botInfo.state,
        retryCount: botInfo.retryCount,
        meshId: meshId
      };
    }

    return status;
  }

  async run(limit: number = 20, lang: string = "en"): Promise<void> {
    /**
     * Run the bot manager (start and wait until stopped)
     * 
     * @param limit - Maximum number of meshes to fetch (default: 20)
     * @param lang - Language code (default: "en")
     */
    await this.start(limit, lang);

    // Wait until shutdown
    return new Promise((resolve) => {
      // Check periodically if shutdown was requested
      const checkInterval = setInterval(() => {
        if (this.shutdownRequested || !this.isRunning) {
          clearInterval(checkInterval);
          this.stop().then(() => resolve());
        }
      }, 1000);
    });
  }
}

