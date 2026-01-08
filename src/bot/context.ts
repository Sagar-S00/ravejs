/**
 * Command context for Rave Bot
 */

import { RaveBot } from './bot';

export class CommandContext {
  bot: RaveBot;
  messageData: Record<string, any>;
  command: string;
  args: string[];
  sender: string;
  messageId: string;
  rawMessage: string;
  senderUserId?: number;
  userMetas: Record<string, any>[];

  constructor(
    bot: RaveBot,
    messageData: Record<string, any>,
    command: string,
    args: string[]
  ) {
    this.bot = bot;
    this.messageData = messageData;
    this.command = command;
    this.args = args;
    this.sender = messageData?.data?.from || "unknown";
    this.messageId = messageData?.data?.id || "";
    this.rawMessage = messageData?.data?.chat || "";
    
    // Extract user ID from sender peer ID (format: {userId}_{uuid})
    try {
      if (this.sender && this.sender !== "unknown") {
        const parts = this.sender.split('_');
        if (parts.length > 0) {
          const userId = parseInt(parts[0], 10);
          if (!isNaN(userId)) {
            this.senderUserId = userId;
          }
        }
      }
    } catch {
      this.senderUserId = undefined;
    }
    
    // Extract user metas from message data
    this.userMetas = messageData?.data?.user_metas || messageData?.user_metas || [];
  }
  
  /**
   * Get message object (for backward compatibility with admin commands)
   */
  get message() {
    return {
      senderUserId: this.senderUserId,
      userMetas: this.userMetas
    };
  }

  async reply(text: string): Promise<void> {
    /**Reply to the command (includes reply reference to original message)*/
    await this.bot.sendMessage(text, this.messageId || undefined);
  }

  async send(text: string): Promise<void> {
    /**Send a message (alias for reply)*/
    await this.reply(text);
  }
}

