/**
 * Multi-Mesh Bot Manager Example (Multi-Process Architecture)
 * Demonstrates connecting to all invited meshes using isolated child processes
 * 
 * This example shows how to:
 * 1. Load credentials from file (if available)
 * 2. Connect to MongoDB for credentials/admin management
 * 3. Use ProcessManager for multi-process architecture
 * 4. Register admin commands for permission management
 * 5. Handle graceful shutdown
 */

import { 
  ProcessManager, 
  RaveAPIClient, 
  setDefaultApiClient, 
  loadCredentials, 
  RaveLogin, 
  saveCredentials,
  connectDatabase,
  ensureCredentialsSync,
  permissionManager
} from '../src/index';
import { ProcessManagerConfig } from '../src/process/types';
import { registerAdminCommands } from './admin_commands';
import { registerCommands } from './bot_commands';
import * as readline from 'readline';

/**
 * Prompt user for email input
 */
function promptEmail(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('Enter your email address: ', (email) => {
      rl.close();
      resolve(email.trim());
    });
  });
}

async function main() {
  let processManager: ProcessManager | null = null;

  try {
    console.log('='.repeat(60));
    console.log('  Rave Multi-Process Bot Manager');
    console.log('='.repeat(60));

    // Step 1: Connect to MongoDB
    console.log('\n[1/5] Connecting to MongoDB...');
    let mongoConnected = false;
    try {
      await connectDatabase();
      console.log('✓ MongoDB connected');
      mongoConnected = true;
    } catch (error: any) {
      console.error(`✗ MongoDB connection failed: ${error.message}`);
      console.log('⚠ Continuing without MongoDB (using local credentials.json only)');
      console.log('  Note: Admin commands and permission management will not be available');
    }

    // Step 2: Load and sync credentials
    console.log('\n[2/5] Loading credentials...');
    let deviceId: string;
    let authToken: string;
    let peerId: string;

    // Try to sync credentials from MongoDB and JSON
    let credentials;
    
    if (mongoConnected) {
      credentials = await ensureCredentialsSync();
    } else {
      credentials = await loadCredentials();
    }

    if (credentials && credentials.deviceId && credentials.authToken) {
      console.log('✓ Loaded credentials from file/database');
      deviceId = credentials.deviceId;
      authToken = credentials.authToken;
      peerId = credentials.peerId || "unknown_peer";
    } else {
      // No credentials found - perform login
      console.log('⚠ No credentials found. Starting login process...');
      console.log('  Please provide your email address to receive a magic link.');

      const email = await promptEmail();

      if (!email) {
        console.error('✗ Email is required. Exiting.');
        process.exit(1);
      }

      console.log(`\n📧 Requesting magic link for ${email}...`);
      console.log('  Please check your email and click the magic link to continue.\n');

      try {
        const loginClient = new RaveLogin(email);
        const loginResult = await loginClient.login(true);

        // Save credentials to both MongoDB and JSON
        const newCredentials = {
          email: email,
          deviceId: loginResult.deviceId,
          ssaid: loginResult.ssaid,
          parseId: loginResult.parseId,
          parseToken: loginResult.parseToken,
          authToken: loginResult.authToken,
          userId: loginResult.userId,
          peerId: loginResult.peerId
        };

        await saveCredentials(newCredentials);
        
        // Import sync after ensuring dependencies are loaded (only if MongoDB is connected)
        if (mongoConnected) {
          const { syncCredentialsToMongoDB } = await import('../src/auth/sync');
          await syncCredentialsToMongoDB();
          console.log('\n✓ Credentials saved to file and database\n');
        } else {
          console.log('\n✓ Credentials saved to file\n');
        }

        // Use new credentials
        deviceId = loginResult.deviceId;
        authToken = loginResult.authToken || loginResult.parseToken;
        peerId = loginResult.peerId || "unknown_peer";
      } catch (error: any) {
        console.error(`\n✗ Login failed: ${error.message}`);
        process.exit(1);
      }
    }

    // Step 3: Initialize API client
    console.log('\n[3/5] Initializing API client...');
    const apiClient = new RaveAPIClient("https://api.red.wemesh.ca", authToken);
    setDefaultApiClient(apiClient);
    console.log('✓ API client initialized');

    // Step 4: Load permissions from MongoDB
    console.log('\n[4/5] Loading permissions from MongoDB...');
    if (mongoConnected) {
      try {
        await permissionManager.refresh();
        const stats = permissionManager.getStats();
        console.log(`✓ Permissions loaded: ${stats.adminCount} admins, ${stats.totalCommands} commands`);
      } catch (error: any) {
        console.log(`⚠ Warning: Could not load permissions: ${error.message}`);
      }
    } else {
      console.log('⚠ Skipping permissions (MongoDB not available)');
    }

    // Step 5: Create ProcessManager
    console.log('\n[5/5] Initializing ProcessManager...');
    
    const config: ProcessManagerConfig = {
      deviceId,
      peerId,
      authToken,
      commandPrefix: ["!", "?", "~", "+"], // Multiple command prefixes
      debug: true, // Enable debug mode
      maxProcesses: Infinity, // Unlimited processes
      statusPollInterval: 30, // Poll every 30 seconds
      processRestartDelay: 5, // Wait 5 seconds before restart
      maxProcessRestarts: 5, // Max 5 restart attempts
      shutdownTimeout: 10, // Wait 10 seconds for graceful shutdown
      maxConnectionAttempts: 3, // Max 3 connection attempts per mesh
      blocklistDuration: 3600000, // 1 hour blocklist
      meshMode: 'invited', // Only invited meshes
      discoveryInterval: 60 // Check for new meshes every 60 seconds
    };

    processManager = new ProcessManager(config, apiClient);
    console.log('✓ ProcessManager created');

    // Note: Admin commands will be registered in child processes
    // They need to be accessible in the bot instances running in workers

    console.log('\n' + '='.repeat(60));
    console.log('  Starting Multi-Process Bot System');
    console.log('='.repeat(60));
    console.log('\nAdmin Commands:');
    console.log('  ?admin @user        - Add user as admin');
    console.log('  ?admin @user remove - Remove admin');
    console.log('  ?refresh            - Reload from MongoDB');
    console.log('  ?setperm <cmd> <level> - Set command permission');
    console.log('  ?removeperm <cmd>   - Remove permission override');
    console.log('  ?listperms          - List all permissions');
    console.log('\n' + '='.repeat(60) + '\n');

    // Setup signal handlers for graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n\n[${signal}] Shutting down gracefully...`);
      
      if (processManager) {
        await processManager.stop();
      }

      console.log('✓ Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Start the process manager
    await processManager.start(20, "en"); // Fetch up to 20 meshes

    // Keep process running
    console.log('\n✓ Bot system started successfully!');
    console.log('  Press Ctrl+C to stop\n');

    // Display periodic status updates
    setInterval(() => {
      const status = processManager!.getStatus();
      const monitor = processManager!.getMonitor();
      const blocklist = processManager!.getBlocklist();
      const healthStats = monitor.getHealthStats();
      const blockStats = blocklist.getStats();

      console.log('\n' + '-'.repeat(60));
      console.log(`Status: ${status.totalBots} processes | ` +
                  `${healthStats.connected} connected | ` +
                  `${healthStats.unhealthy} unhealthy | ` +
                  `${blockStats.total} blocked (${blockStats.permanent} permanent)`);
      console.log('-'.repeat(60) + '\n');
    }, 120000); // Every 2 minutes

    // Block forever until process is killed
    await new Promise(() => {});

  } catch (error: any) {
    console.error('\n✗ Fatal error:', error);
    
    if (processManager) {
      await processManager.stop();
    }
    
    process.exit(1);
  }
}

main().catch(console.error);
