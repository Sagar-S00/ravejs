/**
 * Process Management Type Definitions
 * TypeScript interfaces and enums for multi-process architecture
 */

import { ChildProcess } from 'child_process';
import { CredentialsData } from '../database/models';

/**
 * Process state enum
 */
export enum ProcessState {
  SPAWNING = 'spawning',
  READY = 'ready',
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  UNHEALTHY = 'unhealthy',
  RESTARTING = 'restarting',
  STOPPED = 'stopped',
  BLOCKED = 'blocked'  // Mesh is blocklisted
}

/**
 * Process information tracking
 */
export interface ProcessInfo {
  meshId: string;
  meshData: Record<string, any>;
  process: ChildProcess;
  state: ProcessState;
  connectionAttempts: number;  // Track connection attempts (max 3)
  retryCount: number;
  startedAt: number;
  lastHeartbeat: number;
  config: MeshProcessConfig;
  kicked: boolean;  // Track if kicked to prevent rejoin
}

/**
 * Mesh process configuration
 */
export interface MeshProcessConfig {
  meshId: string;
  server: string;
  authToken: string;
  deviceId: string;
  peerId: string;
  commandPrefix: string | string[];
  debug: boolean;
}

/**
 * Worker status report
 */
export interface WorkerStatus {
  state: string;
  meshId: string;
  connected: boolean;
  uptime: number;
  retryCount: number;
  lastError?: string;
  connectionAttempts?: number;
}

/**
 * Blocked mesh information
 */
export interface BlockedMesh {
  meshId: string;
  reason: 'connection_failures' | 'kicked';
  blockedAt: number;
  blockedUntil: number | null;  // null = permanent (kicked)
}

/**
 * Blocklist data structure (for persistence)
 */
export interface BlocklistData {
  blockedMeshes: Record<string, BlockedMesh>;
}

/**
 * Process Manager configuration
 */
export interface ProcessManagerConfig {
  deviceId: string;
  peerId: string;
  authToken: string;
  commandPrefix: string | string[];
  debug: boolean;
  maxProcesses?: number;
  statusPollInterval?: number;
  processRestartDelay?: number;
  maxProcessRestarts?: number;
  shutdownTimeout?: number;
  maxConnectionAttempts?: number;
  blocklistDuration?: number;
  blocklistPersistPath?: string;
  databaseConfigPath?: string;
  meshMode?: string;
  discoveryInterval?: number;
}

/**
 * Bot status aggregation
 */
export interface BotStatus {
  isRunning: boolean;
  totalBots: number;
  bots: Record<string, {
    state: string;
    retryCount: number;
    meshId: string;
    connectionAttempts: number;
  }>;
}
