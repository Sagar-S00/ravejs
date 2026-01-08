/**
 * Process Monitor
 * Health monitoring for child processes
 */

import { ProcessInfo, ProcessState, WorkerStatus } from './types';
import { createStatusRequest, parseIPCMessage, isStatusResponse } from './ipc';

export interface MonitorConfig {
  statusPollInterval: number;  // seconds
  unhealthyThreshold: number;  // seconds without heartbeat
}

export class ProcessMonitor {
  private config: MonitorConfig;
  private monitoring: boolean = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  private processes: Map<string, ProcessInfo>;
  private onUnhealthy?: (meshId: string, processInfo: ProcessInfo) => void;

  constructor(
    processes: Map<string, ProcessInfo>,
    config?: Partial<MonitorConfig>,
    onUnhealthy?: (meshId: string, processInfo: ProcessInfo) => void
  ) {
    this.processes = processes;
    this.config = {
      statusPollInterval: config?.statusPollInterval || 30,
      unhealthyThreshold: config?.unhealthyThreshold || 60
    };
    this.onUnhealthy = onUnhealthy;
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (this.monitoring) {
      return;
    }

    this.monitoring = true;
    console.log(`[Monitor] Started (poll interval: ${this.config.statusPollInterval}s)`);

    // Start periodic health checks
    this.monitorInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.statusPollInterval * 1000);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.monitoring) {
      return;
    }

    this.monitoring = false;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    console.log('[Monitor] Stopped');
  }

  /**
   * Perform health check on all processes
   */
  private performHealthCheck(): void {
    const now = Date.now();

    for (const [meshId, processInfo] of this.processes.entries()) {
      // Skip stopped processes
      if (processInfo.state === ProcessState.STOPPED || 
          processInfo.state === ProcessState.BLOCKED) {
        continue;
      }

      // Send status request
      this.requestStatus(meshId, processInfo);

      // Check if process is unhealthy (no heartbeat)
      const timeSinceHeartbeat = (now - processInfo.lastHeartbeat) / 1000;
      
      if (timeSinceHeartbeat > this.config.unhealthyThreshold) {
        if (processInfo.state !== ProcessState.UNHEALTHY) {
          console.log(`[Monitor] Process ${meshId} is unhealthy (${timeSinceHeartbeat.toFixed(0)}s since last heartbeat)`);
          processInfo.state = ProcessState.UNHEALTHY;

          // Trigger unhealthy callback
          if (this.onUnhealthy) {
            this.onUnhealthy(meshId, processInfo);
          }
        }
      }
    }
  }

  /**
   * Request status from a process
   */
  private requestStatus(meshId: string, processInfo: ProcessInfo): void {
    try {
      if (processInfo.process && !processInfo.process.killed) {
        const request = createStatusRequest(meshId);
        console.log(`[Monitor] Sending status_request to ${meshId}, PID: ${processInfo.process.pid}`);
        processInfo.process.send(request);
      } else {
        console.log(`[Monitor] Cannot send status_request to ${meshId}: process=${!!processInfo.process}, killed=${processInfo.process?.killed}`);
      }
    } catch (error: any) {
      console.error(`[Monitor] Failed to request status from ${meshId}:`, error.message);
    }
  }

  /**
   * Handle status response from a child process
   */
  handleStatusResponse(meshId: string, status: WorkerStatus): void {
    const processInfo = this.processes.get(meshId);
    
    if (!processInfo) {
      return;
    }

    // Update last heartbeat
    processInfo.lastHeartbeat = Date.now();

    // Update state based on status
    if (status.connected) {
      if (processInfo.state !== ProcessState.CONNECTED) {
        processInfo.state = ProcessState.CONNECTED;
      }
    } else {
      if (processInfo.state === ProcessState.CONNECTED) {
        processInfo.state = ProcessState.DISCONNECTED;
      }
    }

    // Update retry count
    processInfo.retryCount = status.retryCount;

    // Update connection attempts
    if (status.connectionAttempts !== undefined) {
      processInfo.connectionAttempts = status.connectionAttempts;
    }
  }

  /**
   * Get process health metrics
   */
  getProcessHealth(meshId: string): {
    state: ProcessState;
    timeSinceHeartbeat: number;
    isHealthy: boolean;
  } | null {
    const processInfo = this.processes.get(meshId);
    
    if (!processInfo) {
      return null;
    }

    const timeSinceHeartbeat = (Date.now() - processInfo.lastHeartbeat) / 1000;
    const isHealthy = timeSinceHeartbeat <= this.config.unhealthyThreshold;

    return {
      state: processInfo.state,
      timeSinceHeartbeat,
      isHealthy
    };
  }

  /**
   * Get health statistics for all processes
   */
  getHealthStats(): {
    total: number;
    healthy: number;
    unhealthy: number;
    connected: number;
    disconnected: number;
    stopped: number;
  } {
    let healthy = 0;
    let unhealthy = 0;
    let connected = 0;
    let disconnected = 0;
    let stopped = 0;

    const now = Date.now();

    for (const processInfo of this.processes.values()) {
      const timeSinceHeartbeat = (now - processInfo.lastHeartbeat) / 1000;

      if (processInfo.state === ProcessState.STOPPED || 
          processInfo.state === ProcessState.BLOCKED) {
        stopped++;
      } else if (timeSinceHeartbeat <= this.config.unhealthyThreshold) {
        healthy++;
        
        if (processInfo.state === ProcessState.CONNECTED) {
          connected++;
        } else {
          disconnected++;
        }
      } else {
        unhealthy++;
      }
    }

    return {
      total: this.processes.size,
      healthy,
      unhealthy,
      connected,
      disconnected,
      stopped
    };
  }

  /**
   * Check if monitoring is active
   */
  isMonitoring(): boolean {
    return this.monitoring;
  }
}
