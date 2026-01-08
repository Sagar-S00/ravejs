/**
 * MongoDB Connection Manager
 * Manages MongoDB connection lifecycle for all processes
 */

import { MongoClient, Db } from 'mongodb';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface DatabaseConfig {
  uri: string;
  options?: {
    maxPoolSize?: number;
    minPoolSize?: number;
    serverSelectionTimeoutMS?: number;
    socketTimeoutMS?: number;
  };
}

export class DatabaseConnection {
  private static instance: DatabaseConnection;
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private config: DatabaseConfig | null = null;
  private connecting: boolean = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  /**
   * Load database configuration from file
   */
  private async loadConfig(configPath?: string): Promise<DatabaseConfig> {
    const defaultPath = path.join(process.cwd(), 'config', 'database.json');
    const filePath = configPath || defaultPath;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error: any) {
      throw new Error(`Failed to load database config from ${filePath}: ${error.message}`);
    }
  }

  /**
   * Connect to MongoDB
   */
  async connect(configPath?: string): Promise<Db> {
    // Return existing connection if already connected
    if (this.db && this.client) {
      return this.db;
    }

    // Wait if connection is in progress
    if (this.connecting) {
      while (this.connecting) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (this.db) {
        return this.db;
      }
    }

    this.connecting = true;

    try {
      // Load config
      this.config = await this.loadConfig(configPath);

      // Create MongoDB client
      this.client = new MongoClient(this.config.uri, this.config.options);

      // Connect
      await this.client.connect();

      // Get database name from URI
      const dbName = this.extractDatabaseName(this.config.uri);
      this.db = this.client.db(dbName);

      console.log(`[MongoDB] Connected to ${dbName}`);

      return this.db;
    } catch (error: any) {
      this.client = null;
      this.db = null;
      throw new Error(`MongoDB connection failed: ${error.message}`);
    } finally {
      this.connecting = false;
    }
  }

  /**
   * Extract database name from MongoDB URI
   */
  private extractDatabaseName(uri: string): string {
    const match = uri.match(/\/([^/?]+)(\?|$)/);
    return match ? match[1] : 'rave-bot';
  }

  /**
   * Get database instance (must be connected first)
   */
  getDatabase(): Db {
    if (!this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.client !== null && this.db !== null;
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      console.log('[MongoDB] Disconnected');
    }
  }

  /**
   * Ensure connection is alive, reconnect if needed
   */
  async ensureConnection(): Promise<Db> {
    if (!this.isConnected()) {
      return await this.connect();
    }

    // Ping to verify connection
    try {
      await this.db!.admin().ping();
      return this.db!;
    } catch (error) {
      // Reconnect if ping fails
      console.log('[MongoDB] Connection lost, reconnecting...');
      this.client = null;
      this.db = null;
      return await this.connect();
    }
  }
}

/**
 * Get database connection singleton
 */
export function getDatabase(): Db {
  return DatabaseConnection.getInstance().getDatabase();
}

/**
 * Connect to database
 */
export async function connectDatabase(configPath?: string): Promise<Db> {
  return await DatabaseConnection.getInstance().connect(configPath);
}

/**
 * Disconnect from database
 */
export async function disconnectDatabase(): Promise<void> {
  return await DatabaseConnection.getInstance().disconnect();
}
