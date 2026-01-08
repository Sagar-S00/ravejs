# Multi-Process Architecture Guide

## Overview

The Rave SDK now supports a multi-process architecture where each mesh runs in its own isolated Node.js process. This provides better stability, scalability, and resource isolation compared to the single-process model.

## Architecture

```
Parent Process (Orchestrator)
├── ProcessManager - Spawns and manages child processes
├── ProcessMonitor - Health monitoring and status polling
├── MeshBlocklist - Tracks blocked/kicked meshes
└── MongoDB Connection - Credentials and permissions
    │
    ├── Child Process 1 (Mesh A)
    │   ├── MeshWorker
    │   ├── RaveBot Instance
    │   └── MongoDB Connection
    │
    ├── Child Process 2 (Mesh B)
    │   ├── MeshWorker
    │   ├── RaveBot Instance
    │   └── MongoDB Connection
    │
    └── Child Process N (Mesh N)
        ├── MeshWorker
        ├── RaveBot Instance
        └── MongoDB Connection
```

## Features

### ✅ Process Isolation
- Each mesh runs in a separate Node.js process
- Crashes in one mesh don't affect others
- Independent memory space and execution context

### ✅ Mesh Blocklisting
- Meshes that fail 3 connection attempts are blocked for 1 hour
- Kicked meshes are permanently blocked
- Blocklist persists across restarts (`config/blocklist.json`)

### ✅ MongoDB Integration
- Credentials synced between MongoDB and JSON file
- Admin user management stored in MongoDB
- Dynamic command permissions configurable via database

### ✅ Health Monitoring
- Periodic status polling of child processes
- Automatic restart of unhealthy processes
- Configurable health check intervals

### ✅ Permission System
- Global admin users
- Dynamic command permissions (admin/user level)
- Cached for performance with refresh capability

## Setup

### 1. Install Dependencies

```bash
npm install
# or
pnpm install
```

New dependencies added:
- `mongodb@^6.3.0` - MongoDB driver

### 2. Configure MongoDB

Create `config/database.json`:

```json
{
  "uri": "mongodb://localhost:27017/rave-bot",
  "options": {
    "maxPoolSize": 10,
    "minPoolSize": 2,
    "serverSelectionTimeoutMS": 5000,
    "socketTimeoutMS": 45000
  }
}
```

**Note**: Ensure MongoDB is running before starting the bot:

```bash
# Start MongoDB (if using local installation)
mongod

# Or use Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

### 3. Initial Setup

On first run, the system will:
1. Prompt for email (if no credentials exist)
2. Send magic link for authentication
3. Save credentials to both MongoDB and JSON file
4. Connect to meshes and start child processes

```bash
npm start
```

## MongoDB Collections

The system uses three MongoDB collections:

### 1. `credentials` (Singleton)
```javascript
{
  _id: "bot_credentials",
  email: "bot@example.com",
  deviceId: "abc123",
  ssaid: "xyz789",
  parseId: "id123",
  parseToken: "token456",
  authToken: "auth789",
  userId: 12345,
  peerId: "12345_uuid",
  updatedAt: ISODate("2024-01-08T10:00:00Z")
}
```

### 2. `admin_users`
```javascript
{
  _id: "12345",
  userId: 12345,
  addedBy: 67890,
  addedAt: ISODate("2024-01-08T10:00:00Z"),
  isActive: true
}
```

### 3. `command_permissions`
```javascript
{
  _id: "search",
  commandName: "search",
  requiresAdmin: false,
  description: "Search for videos",
  updatedAt: ISODate("2024-01-08T10:00:00Z"),
  updatedBy: 12345
}
```

## Admin Commands

### `?admin @user` or `?admin <userId>`
**Permission**: Admin only (hardcoded)

Add or remove admin users:
```
?admin @JohnDoe              # Make user an admin
?admin @JohnDoe remove       # Remove admin
?admin 12345                 # Add by user ID
?admin 12345 remove          # Remove by user ID
```

### `?refresh`
**Permission**: Admin only (hardcoded)

Reload all data from MongoDB:
```
?refresh
```

Refreshes:
- Credentials from MongoDB → JSON file
- Admin user list
- Command permissions
- Broadcasts refresh to all child processes

### `?setperm <command> <admin|user>`
**Permission**: Admin only (hardcoded)

Configure command permissions:
```
?setperm search admin        # Make search admin-only
?setperm ping user           # Make ping available to all
```

**Note**: Hardcoded admin commands cannot be changed:
- `admin`, `refresh`, `setperm`, `removeperm`, `listperms`, `relogin`

### `?removeperm <command>`
**Permission**: Admin only (hardcoded)

Remove permission override:
```
?removeperm search           # Revert to default permission
```

### `?listperms`
**Permission**: Admin only (hardcoded)

List all command permissions:
```
?listperms
```

Shows:
- Number of admins
- Admin-only commands
- User-accessible commands

## Configuration

### ProcessManager Options

```typescript
const config: ProcessManagerConfig = {
  deviceId: string,
  peerId: string,
  authToken: string,
  commandPrefix: string | string[],
  debug: boolean,
  
  // Process limits
  maxProcesses?: number,              // Max concurrent processes (default: ∞)
  
  // Health monitoring
  statusPollInterval?: number,        // Poll interval in seconds (default: 30)
  
  // Restart behavior
  processRestartDelay?: number,       // Delay before restart in seconds (default: 5)
  maxProcessRestarts?: number,        // Max restart attempts (default: 5)
  
  // Shutdown
  shutdownTimeout?: number,           // Graceful shutdown timeout (default: 10s)
  
  // Blocklist
  maxConnectionAttempts?: number,     // Max attempts before blocking (default: 3)
  blocklistDuration?: number,         // Block duration in ms (default: 3600000 = 1 hour)
  blocklistPersistPath?: string,      // Blocklist file path
  
  // Database
  databaseConfigPath?: string,        // MongoDB config path
  
  // Discovery
  meshMode?: string,                  // "invited" or "all" (default: "invited")
  discoveryInterval?: number          // Mesh discovery interval in seconds (default: 60)
};
```

## Blocklist Behavior

### Connection Failures
- Child process sends `connection_failed` event on each failure
- After 3 failures, mesh is blocked for 1 hour
- Blocklist saved to `config/blocklist.json`
- Automatically unblocks after timeout

### Kicked Meshes
- Child process sends `kicked` event when bot is kicked
- Mesh is **permanently blocked** (no timeout)
- Excluded from future discovery loops
- Can be manually unblocked by editing blocklist file

### Manual Management

View blocklist:
```javascript
const blocklist = processManager.getBlocklist();
const stats = blocklist.getStats();
console.log(`Blocked: ${stats.total} (${stats.permanent} permanent)`);
```

Unblock mesh:
```javascript
await blocklist.unblock('mesh-id');
```

## IPC Communication

Parent and child processes communicate via IPC (Inter-Process Communication):

### Parent → Child Commands
- `shutdown` - Stop the child process (graceful/forced)
- `status_request` - Request health status
- `restart_connection` - Reconnect to mesh
- `refresh_admins` - Reload admin list
- `refresh_permissions` - Reload permissions
- `refresh_credentials` - Update credentials

### Child → Parent Events
- `ready` - Worker initialized
- `connected` - Connected to mesh
- `disconnected` - Disconnected from mesh
- `kicked` - Bot was kicked
- `connection_failed` - Connection attempt failed
- `error` - Error occurred
- `status_response` - Health status report

## Monitoring

The system provides real-time monitoring:

```javascript
// Get overall status
const status = processManager.getStatus();
console.log(`Total processes: ${status.totalBots}`);

// Get health statistics
const monitor = processManager.getMonitor();
const healthStats = monitor.getHealthStats();
console.log(`Connected: ${healthStats.connected}`);
console.log(`Unhealthy: ${healthStats.unhealthy}`);

// Get process health
const health = monitor.getProcessHealth('mesh-id');
if (health) {
  console.log(`State: ${health.state}`);
  console.log(`Healthy: ${health.isHealthy}`);
}
```

## Graceful Shutdown

The system handles graceful shutdown on SIGINT/SIGTERM:

1. Stop mesh discovery loop
2. Stop health monitoring
3. Send shutdown command to all child processes
4. Wait for graceful exit (configurable timeout)
5. Force kill if timeout exceeded
6. Close MongoDB connections

```bash
# Press Ctrl+C to trigger graceful shutdown
^C
[SIGINT] Shutting down gracefully...
[ProcessManager] Stopping...
[ProcessManager] Stopped
✓ Shutdown complete
```

## Troubleshooting

### MongoDB Connection Failed

**Problem**: `MongoDB connection failed`

**Solutions**:
1. Ensure MongoDB is running: `mongod` or `docker start mongodb`
2. Check `config/database.json` URI is correct
3. Verify network connectivity
4. Check MongoDB logs for errors

### Process Spawn Failures

**Problem**: Child processes not spawning

**Solutions**:
1. Check `examples/mesh-worker.ts` exists
2. Ensure `ts-node` is installed: `npm install ts-node`
3. Check for syntax errors in worker script
4. Review parent process logs for errors

### Mesh Blocked

**Problem**: Mesh is blocked and won't connect

**Solutions**:
1. Check `config/blocklist.json` for blocked meshes
2. Wait for timeout (1 hour for connection failures)
3. Manually unblock:
   ```javascript
   const blocklist = processManager.getBlocklist();
   await blocklist.unblock('mesh-id');
   ```
4. Or edit `config/blocklist.json` directly

### Permission Issues

**Problem**: Commands not working / "Admin only" errors

**Solutions**:
1. Check admin status:
   ```
   ?listperms
   ```
2. Add yourself as admin (if you have access):
   ```
   ?admin @YourUsername
   ```
3. Verify MongoDB connection is working
4. Try refreshing:
   ```
   ?refresh
   ```

## Migration from Single-Process

If upgrading from the old `BotManager`:

1. **Install MongoDB**: The new system requires MongoDB
2. **Update imports**: Change `BotManager` to `ProcessManager`
3. **Update config**: Use `ProcessManagerConfig` instead of BotManager config
4. **Update commands**: Admin commands now come from `examples/admin_commands.ts`
5. **Run migration**: First run will sync existing credentials to MongoDB

The old `BotManager` is still available as `LegacyBotManager` for backward compatibility.

## Performance

### Resource Usage
- **Memory**: ~50-100MB per child process (depending on mesh activity)
- **CPU**: Minimal when idle, spikes during message processing
- **Network**: Same as single-process (WebSocket connections per mesh)
- **Disk**: Minimal (blocklist + MongoDB storage)

### Scalability
- Tested with 20+ concurrent meshes
- Each mesh in isolated process
- MongoDB handles concurrent connections efficiently
- Parent process lightweight (orchestration only)

## Example: Adding a Custom Command

1. Register command in `examples/bot_commands.ts`:

```typescript
export function registerCommands(manager: any) {
  manager.command('greet', async (ctx: CommandContext) => {
    await ctx.reply('Hello from multi-process bot!');
  });
}
```

2. Set permission (if needed):

```
?setperm greet admin
```

3. Command is now available in all mesh processes!

## Development

### Running in Development

```bash
# Watch mode (auto-reload on changes)
npm run dev

# Start bot
npm start
```

### Debugging a Specific Mesh

Child process logs are prefixed with mesh ID:

```
[mesh-abc123] [MeshWorker] Starting bot
[mesh-abc123] Bot connected to mesh abc123
```

### Testing

```bash
# Build TypeScript
npm run build

# Run specific test
ts-node test/process-manager.test.ts
```

## Support

For issues or questions:
1. Check this documentation
2. Review MongoDB and process logs
3. Check `config/blocklist.json` for blocked meshes
4. Ensure MongoDB is running and accessible
5. Verify credentials are valid

## License

MIT
