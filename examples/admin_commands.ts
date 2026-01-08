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
}
