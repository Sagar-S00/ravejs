/**
 * Process Manager
 * Orchestrates multi-process mesh bot architecture
 */

import { fork, ChildProcess } from 'child_process';
import * as path from 'path';
import { getMeshes, getMeshInfo, deleteAllInvites } from '../utils/helpers';
import { RaveAPIClient } from '../api/client';
import { ProcessInfo, ProcessState, ProcessManagerConfig, BotStatus, MeshProcessConfig } from './types';
import { ProcessMonitor } from './monitor';
import { MeshBlocklist } from './blocklist';
import {
  parseIPCMessage,
  isEvent,
  createCommand,
  isStatusResponse
} from './ipc';

export class ProcessManager {
  private config: ProcessManagerConfig;
  private apiClient: RaveAPIClient;
  private processes: Map<string, ProcessInfo> = new Map();
  private monitor: ProcessMonitor;
  private blocklist: MeshBlocklist;
  private isRunning: boolean = false;
  private shutdownRequested: boolean = false;
  private discoveryInterval?: NodeJS.Timeout;
  private limit: number = 20;
  private lang: string = "en";

  constructor(config: ProcessManagerConfig, apiClient?: RaveAPIClient) {
    this.config = {
      maxProcesses: config.maxProcesses || Infinity,
      statusPollInterval: config.statusPollInterval || 30,
      processRestartDelay: config.processRestartDelay || 5,
      maxProcessRestarts: Math.max(config.maxProcessRestarts || 5, 3), // Ensure at least 3 restart attempts
      shutdownTimeout: config.shutdownTimeout || 10,
      maxConnectionAttempts: config.maxConnectionAttempts || 3,
      blocklistDuration: config.blocklistDuration || 3600000,  // 1 hour
      blocklistPersistPath: config.blocklistPersistPath || path.join(process.cwd(), 'config', 'blocklist.json'),
      databaseConfigPath: config.databaseConfigPath || path.join(process.cwd(), 'config', 'database.json'),
      meshMode: config.meshMode || 'invited',
      discoveryInterval: config.discoveryInterval || 60,
      ...config
    };
    
    // Ensure maxProcessRestarts is at least 3 after merging config
    this.config.maxProcessRestarts = Math.max(this.config.maxProcessRestarts || 5, 3);

    this.apiClient = apiClient || new RaveAPIClient("https://api.red.wemesh.ca", config.authToken);

    // Initialize blocklist
    this.blocklist = new MeshBlocklist(
      this.config.blocklistPersistPath,
      this.config.blocklistDuration
    );

    // Initialize monitor
    this.monitor = new ProcessMonitor(
      this.processes,
      {
        statusPollInterval: this.config.statusPollInterval!,
        unhealthyThreshold: 60
      },
      (meshId, processInfo) => this.handleUnhealthyProcess(meshId, processInfo)
    );
  }

  /**
   * Fetch meshes from API
   */
  private async fetchMeshes(limit: number = 20, lang: string = "en"): Promise<Record<string, any>[]> {
    try {
      const response = await getMeshes(
        this.config.deviceId,
        this.config.meshMode!,
        limit,
        lang,
        undefined,
        this.apiClient
      );
      return response.data || [];
    } catch (error: any) {
      console.error(`[ProcessManager] Failed to fetch meshes:`, error.message);
      return [];
    }
  }

  /**
   * Spawn a child process for a mesh
   */
  private async spawnProcess(meshId: string, meshData: Record<string, any>): Promise<void> {
    try {
      // Check if already spawned
      if (this.processes.has(meshId)) {
        return;
      }

      // Check if blocked
      if (this.blocklist.isBlocked(meshId)) {
        console.log(`[ProcessManager] Mesh ${meshId} is blocked, skipping spawn`);
        return;
      }

      // Get mesh info for server
      const meshInfo = await getMeshInfo(meshId, this.apiClient);
      const server = meshInfo.server;

      if (!server) {
        console.error(`[ProcessManager] No server found for mesh ${meshId}`);
        return;
      }

      // Create process config
      const processConfig: MeshProcessConfig = {
        meshId,
        server,
        authToken: this.config.authToken,
        deviceId: this.config.deviceId,
        peerId: this.config.peerId,
        commandPrefix: this.config.commandPrefix,
        debug: this.config.debug
      };

      // Fork child process
      const workerPath = path.join(__dirname, '../../examples/mesh-worker.ts');
      const args = [
        '--meshId', meshId,
        '--server', server,
        '--authToken', this.config.authToken,
        '--deviceId', this.config.deviceId,
        '--peerId', this.config.peerId,
        '--commandPrefix', JSON.stringify(this.config.commandPrefix),
        '--debug', String(this.config.debug)
      ];

      const child = fork(workerPath, args, {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, NODE_ENV: 'production' },
        execArgv: ['-r', 'ts-node/register']
      });

      // Create process info
      const processInfo: ProcessInfo = {
        meshId,
        meshData,
        process: child,
        state: ProcessState.SPAWNING,
        connectionAttempts: 0,
        retryCount: 0,
        startedAt: Date.now(),
        lastHeartbeat: Date.now(),
        config: processConfig,
        kicked: false,
        serverDisconnected: false
      };

      this.processes.set(meshId, processInfo);

      // Setup IPC handlers
      this.setupIPCHandlers(meshId, child);

      // Handle process exit
      child.on('exit', (code, signal) => {
        this.handleProcessExit(meshId, code, signal);
      });

      console.log(`[ProcessManager] Spawned process for mesh ${meshId} (PID: ${child.pid})`);

    } catch (error: any) {
      console.error(`[ProcessManager] Failed to spawn process for mesh ${meshId}:`, error.message);
    }
  }

  /**
   * Setup IPC message handlers for a child process
   */
  private setupIPCHandlers(meshId: string, child: ChildProcess): void {
    child.on('message', async (message: any) => {
      const ipcMessage = parseIPCMessage(message);

      if (!ipcMessage) {
        return;
      }

      const processInfo = this.processes.get(meshId);
      if (!processInfo) {
        return;
      }

      // Update heartbeat
      processInfo.lastHeartbeat = Date.now();

      // Handle events from child
      if (isEvent(ipcMessage)) {
        const event = ipcMessage.payload;

        switch (event.type) {
          case 'ready':
            console.log(`[ProcessManager] Process ${meshId} is ready`);
            processInfo.state = ProcessState.READY;
            break;

          case 'connected':
            console.log(`[ProcessManager] Process ${meshId} connected to mesh`);
            processInfo.state = ProcessState.CONNECTED;
            processInfo.connectionAttempts = 0;  // Reset on successful connection
            break;

          case 'disconnected':
            console.log(`[ProcessManager] Process ${meshId} disconnected: ${event.reason}`);
            processInfo.state = ProcessState.DISCONNECTED;
            // Check if it's a server-initiated disconnect (likely empty mesh)
            if (event.reason && event.reason.includes('Server disconnected')) {
              console.log(`[ProcessManager] Server initiated disconnect for ${meshId} - likely empty mesh, will not restart`);
              processInfo.serverDisconnected = true;
              processInfo.state = ProcessState.STOPPED;
            }
            break;

          case 'kicked':
            console.log(`[ProcessManager] Process ${meshId} was kicked`);
            processInfo.kicked = true;
            processInfo.state = ProcessState.STOPPED;
            // Permanently block kicked meshes
            this.blocklist.block(meshId, 'kicked').catch(err =>
              console.error(`[ProcessManager] Failed to block kicked mesh:`, err)
            );
            break;

          case 'connection_failed':
            console.log(`[ProcessManager] Process ${meshId} connection failed (attempt ${event.attempt})`);
            processInfo.connectionAttempts = event.attempt;

            // Block mesh after max attempts
            if (event.attempt >= this.config.maxConnectionAttempts!) {
              console.log(`[ProcessManager] Mesh ${meshId} exceeded max connection attempts, blocking`);
              processInfo.state = ProcessState.BLOCKED;
              this.blocklist.block(meshId, 'connection_failures').catch(err =>
                console.error(`[ProcessManager] Failed to block mesh:`, err)
              );
            }
            break;

          case 'credentials_updated':
            console.log(`[ProcessManager] Process ${meshId} updated credentials, broadcasting to all workers...`);
            // Broadcast refresh_credentials to all child processes
            this.broadcastCommand({
              type: 'refresh_credentials',
              credentials: event.credentials
            });
            break;

          case 'intentional_leave':
            console.log(`[ProcessManager] Process ${meshId} intentionally left - will not restart`);
            processInfo.state = ProcessState.STOPPED;
            // Mark as stopped so it won't be restarted
            break;

          case 'refresh_requested':
            console.log(`[ProcessManager] Process ${meshId} requested refresh, broadcasting to all workers...`);
            // Broadcast refresh commands to all child processes
            this.broadcastCommand({ type: 'refresh_admins' });
            this.broadcastCommand({ type: 'refresh_permissions' });
            // Also sync credentials from MongoDB and broadcast
            try {
              const { syncCredentialsFromMongoDB } = await import('../auth/sync');
              const credentials = await syncCredentialsFromMongoDB();
              if (credentials) {
                this.broadcastCommand({
                  type: 'refresh_credentials',
                  credentials: {
                    authToken: credentials.authToken,
                    deviceId: credentials.deviceId,
                    peerId: credentials.peerId
                  }
                });
              }
            } catch (error: any) {
              console.error(`[ProcessManager] Failed to sync credentials:`, error.message);
            }
            break;

          case 'error':
            console.error(`[ProcessManager] Process ${meshId} error: ${event.error}`);
            break;
        }
      }

      // Handle status responses
      if (isStatusResponse(ipcMessage)) {
        this.monitor.handleStatusResponse(meshId, ipcMessage.payload);
      }
    });

    // Pipe stdout/stderr for logging
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        process.stdout.write(`[${meshId}] ${data}`);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        process.stderr.write(`[${meshId}] ${data}`);
      });
    }
  }

  /**
   * Handle process exit
   */
  private async handleProcessExit(meshId: string, code: number | null, signal: string | null): Promise<void> {
    const processInfo = this.processes.get(meshId);

    if (!processInfo) {
      return;
    }

    console.log(`[ProcessManager] Process ${meshId} exited (code: ${code}, signal: ${signal})`);

    // Don't restart if intentionally stopped (via leave command)
    if (processInfo.state === ProcessState.STOPPED) {
      console.log(`[ProcessManager] Process ${meshId} was intentionally stopped, removing from process list`);
      this.processes.delete(meshId);
      return;
    }

    // Don't restart if kicked, blocked, or server disconnected (empty mesh)
    if (processInfo.kicked || processInfo.state === ProcessState.BLOCKED || processInfo.serverDisconnected) {
      if (processInfo.serverDisconnected) {
        console.log(`[ProcessManager] Process ${meshId} was disconnected by server (likely empty mesh), not restarting`);
      }
      this.processes.delete(meshId);
      return;
    }

    // Don't restart if shutdown requested
    if (this.shutdownRequested) {
      this.processes.delete(meshId);
      return;
    }

    // Check if should restart
    if (processInfo.retryCount < this.config.maxProcessRestarts!) {
      processInfo.retryCount++;
      processInfo.state = ProcessState.RESTARTING;

      console.log(`[ProcessManager] Scheduling restart for mesh ${meshId} (attempt ${processInfo.retryCount}/${this.config.maxProcessRestarts})`);

      // Wait before restarting
      await new Promise(resolve => setTimeout(resolve, this.config.processRestartDelay! * 1000));

      // Remove old process info and respawn
      this.processes.delete(meshId);
      await this.spawnProcess(meshId, processInfo.meshData);
    } else {
      console.error(`[ProcessManager] Max restarts exceeded for mesh ${meshId}`);
      processInfo.state = ProcessState.STOPPED;
      this.processes.delete(meshId);
    }
  }

  /**
   * Handle unhealthy process
   */
  private handleUnhealthyProcess(meshId: string, processInfo: ProcessInfo): void {
    console.log(`[ProcessManager] Process ${meshId} is unhealthy, attempting restart`);

    // Kill the unhealthy process
    try {
      if (processInfo.process && !processInfo.process.killed) {
        processInfo.process.kill('SIGTERM');
      }
    } catch (error: any) {
      console.error(`[ProcessManager] Failed to kill unhealthy process ${meshId}:`, error.message);
    }
  }

  /**
   * Sync meshes (spawn new, remove deleted)
   */
  private async syncMeshes(meshesData: Record<string, any>[]): Promise<void> {
    // Extract mesh IDs from current meshes
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

    // Find new meshes to spawn
    const existingMeshIds = new Set(this.processes.keys());
    const newMeshIds: string[] = [];

    for (const id of currentMeshIds) {
      if (!existingMeshIds.has(id)) {
        newMeshIds.push(id);
      }
    }

    // Find meshes to remove
    const removedMeshIds: string[] = [];
    for (const id of existingMeshIds) {
      if (!currentMeshIds.has(id)) {
        removedMeshIds.push(id);
      }
    }

    // Spawn new processes with rate limiting
    for (let i = 0; i < newMeshIds.length; i++) {
      const meshId = newMeshIds[i];
      const meshData = meshDataMap.get(meshId);

      if (meshData) {
        // Rate limit spawning
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        await this.spawnProcess(meshId, meshData);
      }
    }

    // Stop removed processes
    for (const meshId of removedMeshIds) {
      await this.stopProcess(meshId);
    }
  }

  /**
   * Stop a process
   */
  private async stopProcess(meshId: string, graceful: boolean = true): Promise<void> {
    const processInfo = this.processes.get(meshId);

    if (!processInfo) {
      return;
    }

    try {
      if (processInfo.process && !processInfo.process.killed) {
        // Send shutdown command
        processInfo.process.send(createCommand({ type: 'shutdown', graceful }));

        // Wait a bit for graceful shutdown
        if (graceful) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Force kill if still running
        if (!processInfo.process.killed) {
          processInfo.process.kill('SIGTERM');
        }
      }

      processInfo.state = ProcessState.STOPPED;
      this.processes.delete(meshId);

      console.log(`[ProcessManager] Stopped process for mesh ${meshId}`);
    } catch (error: any) {
      console.error(`[ProcessManager] Failed to stop process ${meshId}:`, error.message);
    }
  }

  /**
   * Discovery loop
   */
  private startDiscoveryLoop(): void {
    this.discoveryInterval = setInterval(async () => {
      if (this.shutdownRequested) {
        return;
      }

      try {
        const meshesData = await this.fetchMeshes(this.limit, this.lang);
        await this.syncMeshes(meshesData);

        // Cleanup expired blocks
        this.blocklist.cleanupExpiredBlocks();
      } catch (error: any) {
        console.error(`[ProcessManager] Error in discovery loop:`, error.message);
      }
    }, this.config.discoveryInterval! * 1000);
  }

  /**
   * Start the process manager
   */
  async start(limit: number = 20, lang: string = "en"): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.shutdownRequested = false;
    this.limit = limit;
    this.lang = lang;

    console.log('[ProcessManager] Starting...');

    // Delete all existing invites before starting
    console.log('[ProcessManager] Deleting all existing invites...');
    const deletedCount = await deleteAllInvites(this.config.deviceId, this.apiClient);
    if (deletedCount > 0) {
      console.log(`[ProcessManager] Deleted ${deletedCount} invites from existing meshes`);
    } else {
      console.log('[ProcessManager] No existing invites to delete');
    }

    // Load blocklist
    await this.blocklist.load();

    // Fetch initial meshes
    const meshesData = await this.fetchMeshes(limit, lang);
    await this.syncMeshes(meshesData);

    // Start monitor
    this.monitor.start();

    // Start discovery loop
    this.startDiscoveryLoop();

    console.log(`[ProcessManager] Started with ${this.processes.size} processes`);
  }

  /**
   * Stop the process manager
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[ProcessManager] Stopping...');

    this.isRunning = false;
    this.shutdownRequested = true;

    // Stop discovery loop
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = undefined;
    }

    // Stop monitor
    this.monitor.stop();

    // Stop all processes
    const stopPromises: Promise<void>[] = [];
    for (const meshId of this.processes.keys()) {
      stopPromises.push(this.stopProcess(meshId, true));
    }

    await Promise.all(stopPromises);

    console.log('[ProcessManager] Stopped');
  }

  /**
   * Get status
   */
  getStatus(): BotStatus {
    const bots: Record<string, any> = {};

    for (const [meshId, processInfo] of this.processes.entries()) {
      bots[meshId] = {
        state: processInfo.state,
        retryCount: processInfo.retryCount,
        meshId: meshId,
        connectionAttempts: processInfo.connectionAttempts
      };
    }

    return {
      isRunning: this.isRunning,
      totalBots: this.processes.size,
      bots
    };
  }

  /**
   * Get blocklist
   */
  getBlocklist(): MeshBlocklist {
    return this.blocklist;
  }

  /**
   * Get monitor
   */
  getMonitor(): ProcessMonitor {
    return this.monitor;
  }

  /**
   * Broadcast command to all child processes
   */
  broadcastCommand(command: any): void {
    const cmdMessage = createCommand(command);

    for (const processInfo of this.processes.values()) {
      if (processInfo.process && !processInfo.process.killed) {
        try {
          processInfo.process.send(cmdMessage);
        } catch (error: any) {
          console.error(`[ProcessManager] Failed to send command to ${processInfo.meshId}:`, error.message);
        }
      }
    }
  }
}
