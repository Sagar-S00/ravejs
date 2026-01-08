/**
 * Permission Manager
 * Manages admin users and command permissions with caching
 */

import { adminRepo, permissionRepo } from '../database/repositories';
import { AdminUserDocument, CommandPermissionDocument } from '../database/models';

export class PermissionManager {
  private adminUsers: Set<number> = new Set();
  private commandPerms: Map<string, boolean> = new Map();
  private lastRefresh: number = 0;
  private refreshing: boolean = false;

  // Hardcoded admin-only commands (cannot be changed)
  private readonly HARDCODED_ADMIN_COMMANDS = new Set([
    'admin',
    'refresh',
    'setperm',
    'removeperm',
    'listperms',
    'relogin'
  ]);

  constructor() {}

  /**
   * Refresh cache from MongoDB
   */
  async refresh(): Promise<void> {
    // Prevent concurrent refreshes
    if (this.refreshing) {
      while (this.refreshing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    this.refreshing = true;

    try {
      // Load admin users
      const admins = await adminRepo.getActiveAdmins();
      this.adminUsers = new Set(admins.map(admin => admin.userId));

      // Load command permissions
      const permissions = await permissionRepo.getAllPermissions();
      this.commandPerms = new Map(
        permissions.map(perm => [perm.commandName.toLowerCase(), perm.requiresAdmin])
      );

      this.lastRefresh = Date.now();
      console.log(`[Permissions] Refreshed: ${this.adminUsers.size} admins, ${this.commandPerms.size} permissions`);
    } catch (error: any) {
      console.error(`[Permissions] Failed to refresh: ${error.message}`);
      throw error;
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Check if user is admin (uses cache)
   */
  isAdmin(userId: number): boolean {
    return this.adminUsers.has(userId);
  }

  /**
   * Check if command requires admin (uses cache, defaults to false)
   */
  requiresAdmin(commandName: string): boolean {
    const normalizedCommand = commandName.toLowerCase();

    // Check hardcoded admin commands first
    if (this.HARDCODED_ADMIN_COMMANDS.has(normalizedCommand)) {
      return true;
    }

    // Check database permissions
    return this.commandPerms.get(normalizedCommand) || false;
  }

  /**
   * Check if user can execute command
   */
  async canExecuteCommand(userId: number, commandName: string): Promise<boolean> {
    // Ensure cache is populated
    if (this.lastRefresh === 0) {
      await this.refresh();
    }

    const isAdmin = this.isAdmin(userId);
    const needsAdmin = this.requiresAdmin(commandName);

    // If command needs admin, check if user is admin
    if (needsAdmin) {
      return isAdmin;
    }

    // Command doesn't need admin, anyone can execute
    return true;
  }

  /**
   * Add admin user
   */
  async addAdmin(userId: number, addedBy: number): Promise<void> {
    await adminRepo.addAdmin(userId, addedBy);
    this.adminUsers.add(userId);
    console.log(`[Permissions] Added admin: ${userId}`);
  }

  /**
   * Remove admin user
   */
  async removeAdmin(userId: number): Promise<boolean> {
    const removed = await adminRepo.removeAdmin(userId);
    if (removed) {
      this.adminUsers.delete(userId);
      console.log(`[Permissions] Removed admin: ${userId}`);
    }
    return removed;
  }

  /**
   * Set command permission
   */
  async setCommandPermission(
    commandName: string,
    requiresAdmin: boolean,
    updatedBy: number,
    description?: string
  ): Promise<void> {
    const normalizedCommand = commandName.toLowerCase();

    // Prevent changing hardcoded admin commands
    if (this.HARDCODED_ADMIN_COMMANDS.has(normalizedCommand)) {
      throw new Error(`Cannot change permission for hardcoded admin command: ${commandName}`);
    }

    await permissionRepo.setPermission(normalizedCommand, requiresAdmin, updatedBy, description);
    this.commandPerms.set(normalizedCommand, requiresAdmin);
    console.log(`[Permissions] Set ${commandName} permission: requiresAdmin=${requiresAdmin}`);
  }

  /**
   * Remove command permission override
   */
  async removeCommandPermission(commandName: string): Promise<boolean> {
    const normalizedCommand = commandName.toLowerCase();

    // Prevent removing hardcoded admin commands
    if (this.HARDCODED_ADMIN_COMMANDS.has(normalizedCommand)) {
      throw new Error(`Cannot remove hardcoded admin command: ${commandName}`);
    }

    const removed = await permissionRepo.removePermission(normalizedCommand);
    if (removed) {
      this.commandPerms.delete(normalizedCommand);
      console.log(`[Permissions] Removed ${commandName} permission override`);
    }
    return removed;
  }

  /**
   * Get all admin users
   */
  getAdmins(): number[] {
    return Array.from(this.adminUsers);
  }

  /**
   * Get all command permissions
   */
  getCommandPermissions(): Map<string, boolean> {
    return new Map(this.commandPerms);
  }

  /**
   * Get admin commands
   */
  getAdminCommands(): string[] {
    const adminCommands: string[] = [];
    
    // Add hardcoded admin commands
    adminCommands.push(...Array.from(this.HARDCODED_ADMIN_COMMANDS));
    
    // Add database admin commands
    for (const [command, requiresAdmin] of this.commandPerms.entries()) {
      if (requiresAdmin && !this.HARDCODED_ADMIN_COMMANDS.has(command)) {
        adminCommands.push(command);
      }
    }

    return adminCommands;
  }

  /**
   * Get user commands
   */
  getUserCommands(): string[] {
    const userCommands: string[] = [];
    
    // Get database user commands
    for (const [command, requiresAdmin] of this.commandPerms.entries()) {
      if (!requiresAdmin) {
        userCommands.push(command);
      }
    }

    return userCommands;
  }

  /**
   * Get permission statistics
   */
  getStats(): {
    adminCount: number;
    adminCommands: number;
    userCommands: number;
    totalCommands: number;
  } {
    const adminCommands = this.getAdminCommands();
    const userCommands = this.getUserCommands();

    return {
      adminCount: this.adminUsers.size,
      adminCommands: adminCommands.length,
      userCommands: userCommands.length,
      totalCommands: adminCommands.length + userCommands.length
    };
  }

  /**
   * Get cache age in seconds
   */
  getCacheAge(): number {
    if (this.lastRefresh === 0) {
      return -1;
    }
    return Math.floor((Date.now() - this.lastRefresh) / 1000);
  }
}

// Export singleton instance
export const permissionManager = new PermissionManager();
