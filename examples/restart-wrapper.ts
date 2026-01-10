/**
 * Restart Wrapper
 * Monitors the main process and restarts it if it crashes (up to 3 times)
 */

import { spawn } from 'child_process';
import * as path from 'path';

const MAX_RESTARTS = 3;
let restartCount = 0;

function startMainProcess() {
  const scriptPath = path.join(__dirname, 'multi-mesh-bot.ts');
  
  console.log(`[RestartWrapper] Starting main process (attempt ${restartCount + 1})...`);
  
  const child = spawn('npx', ['ts-node', scriptPath], {
    stdio: 'inherit',
    shell: true,
    cwd: path.join(__dirname, '..')
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log('[RestartWrapper] Main process exited normally');
      process.exit(0);
    } else {
      restartCount++;
      console.log(`[RestartWrapper] Main process exited with code ${code} (restart ${restartCount}/${MAX_RESTARTS})`);
      
      if (restartCount >= MAX_RESTARTS) {
        console.error(`[RestartWrapper] Max restarts (${MAX_RESTARTS}) exceeded. Exiting.`);
        process.exit(1);
      } else {
        console.log(`[RestartWrapper] Restarting main process in 5 seconds...`);
        setTimeout(() => {
          startMainProcess();
        }, 5000);
      }
    }
  });

  child.on('error', (error) => {
    console.error('[RestartWrapper] Failed to start main process:', error);
    restartCount++;
    
    if (restartCount >= MAX_RESTARTS) {
      console.error(`[RestartWrapper] Max restarts (${MAX_RESTARTS}) exceeded. Exiting.`);
      process.exit(1);
    } else {
      console.log(`[RestartWrapper] Retrying in 5 seconds...`);
      setTimeout(() => {
        startMainProcess();
      }, 5000);
    }
  });
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n[RestartWrapper] Received SIGINT, exiting...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[RestartWrapper] Received SIGTERM, exiting...');
  process.exit(0);
});

// Start the main process
startMainProcess();
