/**
 * MeshWorker Class
 * Wrapper around RaveBot for child process execution
 */

import { RaveBot } from './bot';
import { WorkerStatus, MeshProcessConfig } from '../process/types';
import { PermissionManager, permissionManager } from './permissions';
import { connectDatabase, disconnectDatabase } from '../database/connection';

export class MeshWorker {
  private bot: RaveBot;
  private config: MeshProcessConfig;
  private permissionManager: PermissionManager;
  private startTime: number;
  private connectionAttempts: number = 0;
  private maxConnectionAttempts: number = 3;
  private retryCount: number = 0;
  private lastError: string | undefined;

  constructor(config: MeshProcessConfig, permManager?: PermissionManager) {
    this.config = config;
    this.startTime = Date.now();
    this.permissionManager = permManager || permissionManager;

    // Create RaveBot instance
    this.bot = new RaveBot(
      config.server,
      config.meshId,
      config.peerId,
      config.authToken,
      config.deviceId,
      config.commandPrefix,
      config.debug
    );
  }

  /**
   * Initialize worker (connect to MongoDB, load permissions)
   */
  async initialize(): Promise<void> {
    let mongoConnected = false;
    
    try {
      // Try to connect to MongoDB
      await connectDatabase();
      console.log(`[Worker ${this.config.meshId}] Connected to MongoDB`);
      mongoConnected = true;
    } catch (error: any) {
      console.log(`[Worker ${this.config.meshId}] MongoDB connection failed, continuing without it`);
    }

    // Load permissions only if MongoDB is available
    if (mongoConnected) {
      try {
        await this.permissionManager.refresh();
        console.log(`[Worker ${this.config.meshId}] Permissions loaded`);
      } catch (error: any) {
        console.log(`[Worker ${this.config.meshId}] Warning: Could not load permissions`);
      }
    }
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    try {
      // Track connection attempt
      this.connectionAttempts++;

      if (this.connectionAttempts > this.maxConnectionAttempts) {
        throw new Error(`Max connection attempts (${this.maxConnectionAttempts}) exceeded`);
      }

      console.log(`[Worker ${this.config.meshId}] Starting bot (attempt ${this.connectionAttempts}/${this.maxConnectionAttempts})`);

      // Run bot
      await this.bot.run();
    } catch (error: any) {
      this.lastError = error.message;
      this.retryCount++;
      console.error(`[Worker ${this.config.meshId}] Error:`, error.message);
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop(graceful: boolean = true): Promise<void> {
    try {
      if (this.bot.client) {
        await this.bot.client.disconnect(
          graceful ? 1000 : 1001,
          graceful ? 'Normal closure' : 'Forced closure'
        );
      }

      // Disconnect from MongoDB
      await disconnectDatabase();
      console.log(`[Worker ${this.config.meshId}] Stopped`);
    } catch (error: any) {
      console.error(`[Worker ${this.config.meshId}] Error during stop:`, error.message);
    }
  }

  /**
   * Get worker status
   */
  getStatus(): WorkerStatus {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const connected = this.bot.client?.connected || false;

    return {
      state: connected ? 'connected' : 'disconnected',
      meshId: this.config.meshId,
      connected,
      uptime,
      retryCount: this.retryCount,
      lastError: this.lastError,
      connectionAttempts: this.connectionAttempts
    };
  }

  /**
   * Refresh permissions from MongoDB
   */
  async refreshPermissions(): Promise<void> {
    await this.permissionManager.refresh();
    console.log(`[Worker ${this.config.meshId}] Permissions refreshed`);
  }

  /**
   * Get bot instance
   */
  getBot(): RaveBot {
    return this.bot;
  }

  /**
   * Get permission manager
   */
  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  /**
   * Get config
   */
  getConfig(): MeshProcessConfig {
    return this.config;
  }

  /**
   * Check if bot was kicked
   */
  wasKicked(): boolean {
    // Check if bot has been kicked (from BotManager kicked flag)
    if (this.bot.manager) {
      const meshId = this.bot.roomId;
      const botInfo = this.bot.manager.bots?.get(meshId);
      return botInfo?.kicked || false;
    }
    return false;
  }

  /**
   * Check if connection attempts exceeded
   */
  hasExceededConnectionAttempts(): boolean {
    return this.connectionAttempts >= this.maxConnectionAttempts;
  }

  /**
   * Reset connection attempts counter
   */
  resetConnectionAttempts(): void {
    this.connectionAttempts = 0;
  }
}
