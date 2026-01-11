/**
 * Admin Commands
 * Command handlers for admin management
 */

import { CommandContext } from '../src/bot/context';
import { permissionManager } from '../src/bot/permissions';

/**
 * Register all admin commands on a bot manager
 */
export function registerAdminCommands(manager: any) {
  // ?admin command - Add/remove admin users
  manager.command('admin', async (ctx: CommandContext) => {
    const args = ctx.args;
    
    // Check if requester is admin
    const senderUserId = ctx.message.senderUserId;
    if (!senderUserId) {
      await ctx.reply('❌ Could not identify user');
      return;
    }

    const isAdmin = await permissionManager.isAdmin(senderUserId);
    if (!isAdmin) {
      await ctx.reply('❌ This command requires admin privileges');
      return;
    }

    // Parse arguments
    if (args.length === 0) {
      await ctx.reply('Usage: `?admin @user` or `?admin <userId>` to add admin\n`?admin @user remove` or `?admin <userId> remove` to remove admin');
      return;
    }

    // Extract user ID (from mention or direct input)
    let targetUserId: number | null = null;
    const firstArg = args[0];

    // Check if it's a mention (in userMetas)
    if (firstArg.startsWith('@')) {
      // Look for user in mentions
      const userMetas = ctx.message.userMetas || [];
      if (userMetas.length > 0) {
        const mentionedUser = userMetas[0];
        targetUserId = typeof mentionedUser.id === 'string' 
          ? parseInt(mentionedUser.id, 10) 
          : mentionedUser.id;
      }
    } else {
      // Try to parse as direct user ID
      targetUserId = parseInt(firstArg, 10);
    }

    if (!targetUserId || isNaN(targetUserId)) {
      await ctx.reply('❌ Invalid user ID. Mention a user or provide a valid user ID.');
      return;
    }

    // Check if removing or adding
    const isRemove = args.length > 1 && args[1].toLowerCase() === 'remove';

    try {
      if (isRemove) {
        // Remove admin
        const removed = await permissionManager.removeAdmin(targetUserId);
        if (removed) {
          await ctx.reply(`✅ Removed admin privileges from user ${targetUserId}`);
        } else {
          await ctx.reply(`⚠️ User ${targetUserId} was not an admin`);
        }
      } else {
        // Add admin
        await permissionManager.addAdmin(targetUserId, senderUserId);
        await ctx.reply(`✅ Added user ${targetUserId} as admin`);
      }
    } catch (error: any) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  });

  // ?refresh command - Reload credentials/admins/permissions from MongoDB
  manager.command('refresh', async (ctx: CommandContext) => {
    const senderUserId = ctx.message.senderUserId;
    if (!senderUserId) {
      await ctx.reply('❌ Could not identify user');
      return;
    }

    const isAdmin = await permissionManager.isAdmin(senderUserId);
    if (!isAdmin) {
      await ctx.reply('❌ This command requires admin privileges');
      return;
    }

    try {
      await ctx.reply('🔄 Refreshing from MongoDB...');

      // Refresh permissions
      await permissionManager.refresh();

      // Sync credentials from MongoDB to JSON
      const { syncCredentialsFromMongoDB } = await import('../src/auth/sync');
      const credentials = await syncCredentialsFromMongoDB();
      
      // Update bot's authToken if credentials were synced
      if (credentials && credentials.authToken) {
        ctx.bot.authToken = credentials.authToken;
        // Update WebSocket client's authToken if connected
        if (ctx.bot.client && typeof (ctx.bot.client as any).updateAuthToken === 'function') {
          (ctx.bot.client as any).updateAuthToken(credentials.authToken);
        } else if (ctx.bot.client) {
          (ctx.bot.client as any).authToken = credentials.authToken;
        }
      }

      // Get stats
      const stats = permissionManager.getStats();

      let response = `✅ Refreshed from MongoDB:\n` +
        `- **Admins**: ${stats.adminCount}\n` +
        `- **Admin Commands**: ${stats.adminCommands}\n` +
        `- **User Commands**: ${stats.userCommands}`;
      
      if (credentials) {
        response += `\n- **Credentials**: Synced from MongoDB`;
      }

      await ctx.reply(response);

      // If in a worker process, notify parent to broadcast refresh to all workers
      if (process.send) {
        const { createEvent } = await import('../src/process/ipc');
        process.send(createEvent({ type: 'refresh_requested' }));
      }
    } catch (error: any) {
      await ctx.reply(`❌ Refresh failed: ${error.message}`);
    }
  });

  // ?setperm command - Configure command permissions
  manager.command('setperm', async (ctx: CommandContext) => {
    const args = ctx.args;
    const senderUserId = ctx.message.senderUserId;
    
    if (!senderUserId) {
      await ctx.reply('❌ Could not identify user');
      return;
    }

    const isAdmin = await permissionManager.isAdmin(senderUserId);
    if (!isAdmin) {
      await ctx.reply('❌ This command requires admin privileges');
      return;
    }

    if (args.length < 2) {
      await ctx.reply('Usage: `?setperm <command> <admin|user>`\nExample: `?setperm search admin`');
      return;
    }

    const commandName = args[0].toLowerCase();
    const level = args[1].toLowerCase();

    if (level !== 'admin' && level !== 'user') {
      await ctx.reply('❌ Permission level must be `admin` or `user`');
      return;
    }

    const requiresAdmin = level === 'admin';

    try {
      await permissionManager.setCommandPermission(commandName, requiresAdmin, senderUserId);
      await ctx.reply(`✅ Set \`${commandName}\` permission to: **${level}**`);
    } catch (error: any) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  });

  // ?removeperm command - Remove permission override
  manager.command('removeperm', async (ctx: CommandContext) => {
    const args = ctx.args;
    const senderUserId = ctx.message.senderUserId;
    
    if (!senderUserId) {
      await ctx.reply('❌ Could not identify user');
      return;
    }

    const isAdmin = await permissionManager.isAdmin(senderUserId);
    if (!isAdmin) {
      await ctx.reply('❌ This command requires admin privileges');
      return;
    }

    if (args.length === 0) {
      await ctx.reply('Usage: `?removeperm <command>`\nExample: `?removeperm search`');
      return;
    }

    const commandName = args[0].toLowerCase();

    try {
      const removed = await permissionManager.removeCommandPermission(commandName);
      if (removed) {
        await ctx.reply(`✅ Removed permission override for \`${commandName}\``);
      } else {
        await ctx.reply(`⚠️ No permission override found for \`${commandName}\``);
      }
    } catch (error: any) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  });

  // ?listperms command - List all command permissions
  manager.command('listperms', async (ctx: CommandContext) => {
    const senderUserId = ctx.message.senderUserId;
    
    if (!senderUserId) {
      await ctx.reply('❌ Could not identify user');
      return;
    }

    const isAdmin = await permissionManager.isAdmin(senderUserId);
    if (!isAdmin) {
      await ctx.reply('❌ This command requires admin privileges');
      return;
    }

    try {
      const adminCommands = permissionManager.getAdminCommands();
      const userCommands = permissionManager.getUserCommands();
      const stats = permissionManager.getStats();

      let response = '**📋 Command Permissions**\n\n';
      response += `**Admins**: ${stats.adminCount}\n\n`;

      if (adminCommands.length > 0) {
        response += `**Admin Commands** (${adminCommands.length}):\n`;
        adminCommands.forEach(cmd => {
          response += `- \`${cmd}\`\n`;
        });
        response += '\n';
      }

      if (userCommands.length > 0) {
        response += `**User Commands** (${userCommands.length}):\n`;
        userCommands.forEach(cmd => {
          response += `- \`${cmd}\`\n`;
        });
      }

      if (adminCommands.length === 0 && userCommands.length === 0) {
        response += 'No custom permissions configured.';
      }

      await ctx.reply(response);
    } catch (error: any) {
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  });

  // ?inviteall command - Invite users from recent contacts or public meshes
  manager.command('inviteall', async (ctx: CommandContext) => {
    const args = ctx.args;
    const senderUserId = ctx.message.senderUserId;
    
    if (!senderUserId) {
      await ctx.reply('❌ Could not identify user');
      return;
    }

    const isAdmin = await permissionManager.isAdmin(senderUserId);
    if (!isAdmin) {
      await ctx.reply('❌ This command requires admin privileges');
      return;
    }

    // Check if deviceId is available
    if (!ctx.bot.deviceId) {
      await ctx.reply('❌ Device ID not available. Cannot invite users.');
      return;
    }

    // Parse mode: "recent" (default) or "public"
    const mode = args.length > 0 ? args[0].toLowerCase() : 'recent';
    
    if (mode !== 'recent' && mode !== 'public') {
      await ctx.reply('❌ Invalid mode. Use `?inviteall recent` or `?inviteall public`');
      return;
    }

    try {
      await ctx.reply(`🔄 Fetching users from ${mode === 'public' ? 'public meshes' : 'recent contacts'}...`);

      // Import required functions
      const { getRecentUsers, getMeshesWithFilters, inviteUsers } = await import('../src/utils/helpers');
      const { RaveAPIClient } = await import('../src/api/client');

      // Create API client
      const apiClient = new RaveAPIClient("https://api.red.wemesh.ca", ctx.bot.authToken);

      const userIds: number[] = [];
      const userMetas: Array<{ handle: string; id: number }> = [];
      const seenUserIds = new Set<number>();
      let totalMeshesFetched = 0;

      if (mode === 'recent') {
        // Fetch recent users from contacts
        const recentUsersResponse = await getRecentUsers(100, apiClient);
        const users = recentUsersResponse.data || [];

        for (const user of users) {
          if (user.id && user.handle) {
            const userId = typeof user.id === 'string' ? parseInt(user.id, 10) : user.id;
            if (!isNaN(userId) && !seenUserIds.has(userId)) {
              seenUserIds.add(userId);
              userIds.push(userId);
              userMetas.push({
                handle: user.handle,
                id: userId
              });
            }
          }
        }
      } else {
        // Fetch users from public meshes (20-30 meshes)
        const targetMeshes = 30;
        let cursor: string | undefined = undefined;
        let hasMore = true;

        while (totalMeshesFetched < targetMeshes && hasMore) {
          const limit = Math.min(20, targetMeshes - totalMeshesFetched);
          
          const meshesResponse = await getMeshesWithFilters(
            ctx.bot.deviceId,
            {
              public: true,
              friends: false,
              local: false,
              invited: false,
              limit: limit,
              lang: "en",
              cursor: cursor
            },
            apiClient
          );

          const meshes = meshesResponse.data || [];
          totalMeshesFetched += meshes.length;

          // Extract unique users from all meshes
          for (const meshData of meshes) {
            const users = meshData.users || [];
            for (const user of users) {
              if (user.id && user.handle) {
                const userId = typeof user.id === 'string' ? parseInt(user.id, 10) : user.id;
                if (!isNaN(userId) && !seenUserIds.has(userId)) {
                  seenUserIds.add(userId);
                  userIds.push(userId);
                  userMetas.push({
                    handle: user.handle,
                    id: userId
                  });
                }
              }
            }
          }

          // Check for next page
          const paging = meshesResponse.paging || {};
          if (paging.next) {
            // Extract cursor from next URL
            try {
              const url = new URL(paging.next);
              cursor = url.searchParams.get('cursor') || undefined;
              hasMore = !!cursor;
            } catch {
              hasMore = false;
            }
          } else {
            hasMore = false;
          }

          // Small delay to avoid rate limiting
          if (hasMore && totalMeshesFetched < targetMeshes) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        // Don't send message here, wait until after fetching is complete
      }

      // Send total users fetched message
      if (mode === 'public') {
        await ctx.reply(`📊 Fetched ${totalMeshesFetched} public meshes, found ${userIds.length} unique users`);
      } else {
        await ctx.reply(`📊 Found ${userIds.length} unique users from recent contacts`);
      }

      if (userIds.length === 0) {
        await ctx.reply('⚠️ No valid users found to invite');
        return;
      }

      // Split into chunks of 80 for both invites and mentions
      const chunkSize = 80;
      const totalChunks = Math.ceil(userIds.length / chunkSize);
      
      await ctx.reply(`📤 Inviting ${userIds.length} users in ${totalChunks} batches of ${chunkSize}...`);
      
      // Invite all users first (in chunks)
      for (let i = 0; i < userIds.length; i += chunkSize) {
        const userIdChunk = userIds.slice(i, i + chunkSize);
        
        // Invite this chunk of users
        await inviteUsers(
          ctx.bot.roomId,
          userIdChunk,
          ctx.bot.deviceId,
          false,
          apiClient
        );
      }
      
      // Now send mention messages with 4 second delay between batches
      for (let i = 0; i < userMetas.length; i += chunkSize) {
        const userMetaChunk = userMetas.slice(i, i + chunkSize);
        const chunkNumber = Math.floor(i / chunkSize) + 1;
        
        // Build mention text for this chunk
        const mentionText = userMetaChunk.map(meta => `@${meta.handle}`).join(' ');
        
        // Send message with mentions for this chunk
        if (chunkNumber === 1) {
          await ctx.bot.sendMessage(
            `✅ Invited ${userIds.length} users to the mesh! (Batch ${chunkNumber}/${totalChunks}) ${mentionText}`,
            undefined,
            undefined,
            userMetaChunk
          );
        } else {
          await ctx.bot.sendMessage(
            `(Batch ${chunkNumber}/${totalChunks}) ${mentionText}`,
            undefined,
            undefined,
            userMetaChunk
          );
        }
        
        // 4 second delay between batches
        if (i + chunkSize < userMetas.length) {
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      }

    } catch (error: any) {
      await ctx.reply(`❌ Error: ${error.message}`);
      console.error('InviteAll error:', error);
    }
  });
}
