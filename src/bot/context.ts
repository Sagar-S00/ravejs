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

