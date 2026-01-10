/**
 * Mesh Worker Entry Point
 * Child process script that runs a single mesh bot
 */

import { MeshWorker } from '../src/bot/worker';
import { MeshProcessConfig } from '../src/process/types';
import {
  parseIPCMessage,
  isCommand,
  isStatusRequest,
  createEvent,
  createStatusResponse,
  type ParentCommand
} from '../src/process/ipc';
import { registerBotCommands } from './bot_commands';
import { registerAdminCommands } from './admin_commands';

// Parse command-line arguments
function parseArgs(): MeshProcessConfig {
  const args = process.argv.slice(2);
  const config: any = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    const value = args[i + 1];

    if (key === 'commandPrefix') {
      try {
        config[key] = JSON.parse(value);
      } catch {
        config[key] = value;
      }
    } else if (key === 'debug') {
      config[key] = value === 'true';
    } else {
      config[key] = value;
    }
  }

  return config as MeshProcessConfig;
}

// Main worker function
async function main() {
  let worker: MeshWorker | null = null;
  let running = true;

  try {
    // Parse configuration
    const config = parseArgs();
    console.log(`[MeshWorker] Starting worker for mesh ${config.meshId}`);

    // Create worker instance
    worker = new MeshWorker(config);

    // Set up IPC message handler FIRST (before anything blocks)
    console.log(`[MeshWorker] Setting up IPC message handler for mesh ${config.meshId}`);
    process.on('message', async (message: any) => {
      console.log(`[MeshWorker] Received IPC message:`, message?.type || 'unknown');
      const ipcMessage = parseIPCMessage(message);
      
      if (!ipcMessage) {
        console.log(`[MeshWorker] Failed to parse IPC message`);
        return;
      }

      try {
        // Handle status requests separately (they have type 'status_request', not 'command')
        if (ipcMessage.type === 'status_request') {
          console.log(`[MeshWorker] Processing status_request`);
          if (worker && process.send) {
            const status = worker.getStatus();
            console.log(`[MeshWorker] Sending status response:`, status);
            process.send(createStatusResponse(status, ipcMessage.messageId));
          } else {
            console.log(`[MeshWorker] Cannot send status: worker=${!!worker}, process.send=${!!process.send}`);
          }
          return; // Exit early after handling status request
        }
        // Handle commands
        if (ipcMessage.type === 'command') {
          const command = ipcMessage.payload as ParentCommand;
          console.log(`[MeshWorker] Received command: ${command.type}`);

          switch (command.type) {
            case 'shutdown':
              console.log(`[MeshWorker] Received shutdown command (graceful: ${command.graceful})`);
              running = false;
              if (worker) {
                await worker.stop(command.graceful);
              }
              process.exit(0);
              break;

            case 'restart_connection':
              console.log('[MeshWorker] Received restart connection command');
              if (worker) {
                await worker.stop(true);
                await worker.start();
              }
              break;

            case 'refresh_admins':
            case 'refresh_permissions':
              console.log(`[MeshWorker] Received ${command.type} command`);
              if (worker) {
                await worker.refreshPermissions();
              }
              break;

            case 'refresh_credentials':
              console.log('[MeshWorker] Received refresh credentials command');
              // Update bot's authToken immediately without restart
              if (worker && command.credentials) {
                const bot = worker.getBot();
                // Update bot's authToken immediately
                bot.authToken = command.credentials.authToken || bot.authToken;
                // Update worker config
                const config = worker.getConfig();
                config.authToken = command.credentials.authToken || config.authToken;
                config.deviceId = command.credentials.deviceId || config.deviceId;
                config.peerId = command.credentials.peerId || config.peerId;
                
                // Update WebSocket client's authToken if connected
                if (bot.client && typeof (bot.client as any).updateAuthToken === 'function') {
                  (bot.client as any).updateAuthToken(bot.authToken);
                } else if (bot.client) {
                  (bot.client as any).authToken = bot.authToken;
                }
                
                console.log('[MeshWorker] Credentials updated, bot will use new credentials for future requests');
              }
              break;
          }
        }
      } catch (error: any) {
        console.error('[MeshWorker] Error handling IPC message:', error.message);
        if (process.send) {
          process.send(createEvent({ type: 'error', error: error.message }));
        }
      }
    });

    // Initialize (connect to MongoDB, load permissions)
    await worker.initialize();

    // Send ready event to parent
    if (process.send) {
      process.send(createEvent({ type: 'ready', meshId: config.meshId }));
    }

    // Register bot event handlers
    const bot = worker.getBot();

    // Register bot commands
    console.log(`[MeshWorker] Registering commands for mesh ${config.meshId}`);
    registerBotCommands(bot);
    registerAdminCommands(bot);

    // On connected
    bot.event('on_connected', async () => {
      console.log(`[MeshWorker] Bot connected to mesh ${config.meshId}`);
      if (process.send) {
        process.send(createEvent({ type: 'connected' }));
        // Reset connection attempts on successful connection
        worker?.resetConnectionAttempts();
      }
    });

    // On kicked
    bot.event('on_kicked', async () => {
      console.log(`[MeshWorker] Bot kicked from mesh ${config.meshId}`);
      if (process.send) {
        process.send(createEvent({ type: 'kicked', meshId: config.meshId }));
      }
      running = false;
      process.exit(0);
    });

    // Start the worker
    console.log(`[MeshWorker] Starting bot for mesh ${config.meshId}`);
    await worker.start();

    // If we reached here, bot disconnected
    if (running) {
      console.log(`[MeshWorker] Bot disconnected from mesh ${config.meshId}`);
      
      // Check if server initiated disconnect
      const bot = worker.getBot();
      if (bot.serverDisconnected) {
        console.log(`[MeshWorker] Server initiated disconnect, exiting gracefully`);
        // Give time for the disconnected event to be sent
        await new Promise(resolve => setTimeout(resolve, 500));
        process.exit(0);
      }
      
      // Check if connection attempts exceeded
      if (worker.hasExceededConnectionAttempts()) {
        console.log(`[MeshWorker] Max connection attempts exceeded for mesh ${config.meshId}`);
        if (process.send) {
          process.send(createEvent({
            type: 'connection_failed',
            meshId: config.meshId,
            attempt: worker.getStatus().connectionAttempts || 0
          }));
        }
        process.exit(1);
      } else {
        // Send connection failed event only if we haven't already sent disconnected event
        if (process.send && !bot.serverDisconnected) {
          process.send(createEvent({
            type: 'connection_failed',
            meshId: config.meshId,
            attempt: worker.getStatus().connectionAttempts || 0
          }));
          
          process.send(createEvent({ type: 'disconnected', reason: 'Connection lost' }));
        }
        process.exit(1);
      }
    }

  } catch (error: any) {
    console.error(`[MeshWorker] Fatal error:`, error);
    
    if (process.send) {
      process.send(createEvent({ type: 'error', error: error.message }));
    }

    // Check connection attempts
    if (worker && worker.hasExceededConnectionAttempts()) {
      if (process.send) {
        process.send(createEvent({
          type: 'connection_failed',
          meshId: worker.getConfig().meshId,
          attempt: worker.getStatus().connectionAttempts || 0
        }));
      }
    }

    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[MeshWorker] Uncaught exception:', error);
  if (process.send) {
    process.send(createEvent({ type: 'error', error: error.message }));
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[MeshWorker] Unhandled rejection at:', promise, 'reason:', reason);
  if (process.send) {
    process.send(createEvent({ type: 'error', error: String(reason) }));
  }
  process.exit(1);
});

// Start the worker
main().catch((error) => {
  console.error('[MeshWorker] Failed to start:', error);
  process.exit(1);
});
