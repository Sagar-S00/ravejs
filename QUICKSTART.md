# Quick Start Guide - Multi-Process Bot

## Prerequisites

1. **Node.js** >= 18.0.0
2. **MongoDB** (local or remote)
3. **pnpm** or **npm**

## 5-Minute Setup

### Step 1: Install MongoDB

**Option A: Docker (Recommended)**
```bash
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

**Option B: Local Installation**
```bash
# macOS
brew install mongodb-community
brew services start mongodb-community

# Ubuntu/Debian
sudo apt-get install mongodb
sudo systemctl start mongodb

# Windows
# Download from https://www.mongodb.com/try/download/community
```

### Step 2: Install Dependencies

```bash
npm install
# or
pnpm install
```

### Step 3: Configure Database

The system uses default MongoDB settings. If you need custom configuration, edit `config/database.json`:

```json
{
  "uri": "mongodb://localhost:27017/rave-bot",
  "options": {
    "maxPoolSize": 10,
    "minPoolSize": 2
  }
}
```

### Step 4: Start the Bot

```bash
npm start
```

**First Run:**
- System will prompt for your email
- Check your email for the magic link
- Click the link to authenticate
- Bot will save credentials and start

**Subsequent Runs:**
- Bot loads credentials automatically
- Connects to MongoDB
- Spawns processes for each mesh

## Usage

### Admin Commands

Run these commands in any mesh chat where the bot is present:

```bash
# User Management
?admin @username              # Add user as admin
?admin @username remove       # Remove admin
?admin 12345                  # Add by user ID

# Permission Management
?setperm search admin         # Make command admin-only
?setperm search user          # Make command public
?removeperm search            # Remove custom permission
?listperms                    # Show all permissions

# System Management
?refresh                      # Reload from MongoDB
```

### Monitoring

The bot displays status every 2 minutes:
```
Status: 5 processes | 4 connected | 0 unhealthy | 2 blocked (1 permanent)
```

### Shutdown

Press `Ctrl+C` for graceful shutdown.

## Architecture

```
Parent Process
├── Spawns child process per mesh
├── Monitors health
├── Manages blocklist
└── Coordinates shutdown

Child Process (per mesh)
├── Connects to MongoDB
├── Loads permissions
├── Runs RaveBot
└── Reports status via IPC
```

## Key Features

✅ **Process Isolation**: Each mesh in separate process
✅ **Auto-Restart**: Failed processes restart automatically
✅ **Blocklisting**: 3 failed attempts → 1-hour block
✅ **Kick Protection**: Kicked meshes permanently blocked
✅ **Admin System**: MongoDB-based permission management
✅ **Health Monitoring**: Automatic health checks

## Troubleshooting

### MongoDB Connection Failed

```bash
# Check if MongoDB is running
docker ps | grep mongo
# or
brew services list | grep mongodb

# Start MongoDB
docker start mongodb
# or
brew services start mongodb-community
```

### Bot Won't Start

```bash
# Check credentials
cat config/credentials.json

# Check MongoDB config
cat config/database.json

# Clear blocklist if needed
rm config/blocklist.json

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Command Not Working

1. Check if you're an admin: `?listperms`
2. Add yourself as admin if needed (requires existing admin)
3. Try refreshing: `?refresh`

## Next Steps

- Read [MULTI_PROCESS_README.md](MULTI_PROCESS_README.md) for detailed documentation
- Review [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) for architecture details
- Check MongoDB collections to see stored data
- Customize command permissions via `?setperm`

## Support

Common issues:
- **"MongoDB connection failed"**: MongoDB not running
- **"Max connection attempts"**: Mesh blocked for 1 hour
- **"Admin only command"**: You're not an admin
- **Process crashes**: Check logs in terminal

For detailed troubleshooting, see the [MULTI_PROCESS_README.md](MULTI_PROCESS_README.md).

## Example Session

```bash
$ npm start

=============================================================
  Rave Multi-Process Bot Manager
=============================================================

[1/5] Connecting to MongoDB...
✓ MongoDB connected

[2/5] Loading credentials...
✓ Loaded credentials from file/database

[3/5] Initializing API client...
✓ API client initialized

[4/5] Loading permissions from MongoDB...
✓ Permissions loaded: 1 admins, 3 commands

[5/5] Initializing ProcessManager...
✓ ProcessManager created

=============================================================
  Starting Multi-Process Bot System
=============================================================

Admin Commands:
  ?admin @user        - Add user as admin
  ?admin @user remove - Remove admin
  ?refresh            - Reload from MongoDB
  ?setperm <cmd> <level> - Set command permission
  ?removeperm <cmd>   - Remove permission override
  ?listperms          - List all permissions

=============================================================

[ProcessManager] Starting...
[ProcessManager] Spawned process for mesh abc123 (PID: 12345)
[ProcessManager] Spawned process for mesh def456 (PID: 12346)
[ProcessManager] Started with 2 processes

✓ Bot system started successfully!
  Press Ctrl+C to stop

------------------------------------------------------------
Status: 2 processes | 2 connected | 0 unhealthy | 0 blocked
------------------------------------------------------------
```

Enjoy your multi-process bot! 🚀
