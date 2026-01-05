/**
 * Bot command handlers
 * Register all bot commands with the manager
 */

import { BotManager } from '../src/bot/manager';
import { RaveBot } from '../src/bot/bot';
import { getTruth, getDare } from '../src/utils/truth_dare';
import { searchAndSendVideos, findVideoInfoByReply } from './video_utils';
import { getVideoId, voteVideo } from '../src/utils/helpers';

export function registerCommands(manager: BotManager): void {
  /**Register all bot commands with the manager*/
  
  manager.command("hello", async (ctx) => {
    /**Say hello*/
    await ctx.reply("Hello! 👋 I'm a multi-mesh bot!");
  });
  
  manager.command("status", async (ctx) => {
    /**Show bot manager status*/
    const status = manager.getStatus();
    const statusText = `**Bot Manager Status:**\n` +
      `Running: ${status.isRunning}\n` +
      `Total Bots: ${status.totalBots}\n` +
      `Connected: ${Object.values(status.bots).filter((b: any) => b.state === "connected").length}`;
    await ctx.reply(statusText);
  });
  
  manager.command("meshinfo", async (ctx) => {
    /**Show current mesh information*/
    const meshId = ctx.bot.roomId;
    const info = `**Mesh Info:**\n` +
      `Mesh ID: \`${meshId.substring(0, 8)}...\`\n` +
      `Server: \`${ctx.bot.server}\``;
    await ctx.reply(info);
  });
  
  manager.command("set", async (ctx) => {
    /**Set/vote for a video by replying to a search result*/
    const messageData = ctx.messageData?.data || {};
    const replyTo = messageData.reply;
    
    if (!replyTo) {
      const prefixes = ctx.bot.commandPrefixes.join(", ");
      await ctx.reply(`❌ Please reply to a search result to set a video. Use \`${prefixes[0]}search <query>\` first.`);
      return;
    }
    
    const bot = ctx.bot;
    const videoInfo = findVideoInfoByReply(bot, replyTo);
    
    if (videoInfo) {
      const roomId = bot.roomId;
      // Use default API client (like Python does) - don't pass apiClient parameter
      
      try {
        // Call without apiClient parameter - uses default (like Python)
        const videoId = await getVideoId(videoInfo);
        // For voteVideo, also use default client
        await voteVideo(videoId, roomId, bot.deviceId);
        await ctx.reply(`✅ Video set: ${videoInfo.title || "Unknown"}`);
      } catch (error: any) {
        console.error(`Error setting video:`, error);
        await ctx.reply(`❌ Failed to set video: ${error.message}`);
      }
    } else {
      await ctx.reply("❌ No video found for this message. Make sure you're replying to a search result.");
    }
  });
  
  manager.command("search", async (ctx) => {
    /**Search for videos and show top 3 results with thumbnails*/
    if (ctx.args.length > 0) {
      const query = ctx.args.join(" ");
      await ctx.reply(`Searching for: ${query}`);
      await searchAndSendVideos(ctx.bot, query);
    } else {
      const prefixes = ctx.bot.commandPrefixes.join(", ");
      await ctx.reply(`Usage: \`${prefixes[0]}search <query>\``);
    }
  });
  
  manager.command("truth", async (ctx) => {
    /**Get a truth question (rating: PG, PG13, or R)*/
    let rating: "PG" | "PG13" | "R" = "PG"; // Default rating
    if (ctx.args.length > 0) {
      const ratingArg = ctx.args[0].toUpperCase();
      if (ratingArg === "PG" || ratingArg === "PG13" || ratingArg === "R") {
        rating = ratingArg as "PG" | "PG13" | "R";
      } else {
        await ctx.reply(`❌ Invalid rating. Use PG, PG13, or R. Using default: PG`);
      }
    }
    
    try {
      const question = await getTruth(rating);
      await ctx.reply(`**Truth (${rating}):**\n${question}`);
    } catch (error: any) {
      console.error(`Error fetching truth question:`, error);
      await ctx.reply("❌ Failed to fetch truth question. Please try again later.");
    }
  });
  
  manager.command("dare", async (ctx) => {
    /**Get a dare challenge (rating: PG, PG13, or R)*/
    let rating: "PG" | "PG13" | "R" = "PG"; // Default rating
    if (ctx.args.length > 0) {
      const ratingArg = ctx.args[0].toUpperCase();
      if (ratingArg === "PG" || ratingArg === "PG13" || ratingArg === "R") {
        rating = ratingArg as "PG" | "PG13" | "R";
      } else {
        await ctx.reply(`❌ Invalid rating. Use PG, PG13, or R. Using default: PG`);
      }
    }
    
    try {
      const question = await getDare(rating);
      await ctx.reply(`**Dare (${rating}):**\n${question}`);
    } catch (error: any) {
      console.error(`Error fetching dare:`, error);
      await ctx.reply("❌ Failed to fetch dare. Please try again later.");
    }
  });
}

