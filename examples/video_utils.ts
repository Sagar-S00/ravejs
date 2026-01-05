/**
 * Video search and upload utilities
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RaveBot } from '../src/bot/bot';
import { RaveAPIClient } from '../src/api/client';
import { searchAndGetVideoData, VideoData } from '../src/utils/youtube_search';
import { getVideoId, voteVideo, uploadMedia } from '../src/utils/helpers';

// Extend RaveBot to include video_info_map
interface BotWithVideoInfo extends RaveBot {
  videoInfoMap?: Map<string, VideoData>;
}

/**
 * Search for videos and send top 3 results with thumbnails
 */
export async function searchAndSendVideos(bot: RaveBot, query: string): Promise<void> {
  try {
    const results = await searchAndGetVideoData(query, 3);
    
    if (!results || results.length === 0) {
      await bot.sendMessage("❌ No videos found");
      return;
    }
    
    const botWithVideoInfo = bot as BotWithVideoInfo;
    if (!botWithVideoInfo.videoInfoMap) {
      botWithVideoInfo.videoInfoMap = new Map();
    }
    
    const tempFiles: string[] = [];
    try {
      for (const videoInfo of results) {
        const thumbnailUrl = videoInfo.thumbnail;
        if (!thumbnailUrl) {
          // Send without thumbnail
          const title = videoInfo.title || "Unknown";
          const author = videoInfo.author || "Unknown";
          const messageText = `${title}\nby ${author}`;
          
          const sentMessageId = await bot.sendMessage(messageText);
          if (sentMessageId) {
            botWithVideoInfo.videoInfoMap.set(sentMessageId, videoInfo);
            // Also update recentBotMessages
            const recentMsg = bot.recentBotMessages.find(m => m.id === sentMessageId);
            if (recentMsg) {
              (recentMsg as any).videoInfo = videoInfo;
            }
          }
          continue;
        }
        
        try {
          // Download thumbnail
          const response = await axios.get(thumbnailUrl, {
            responseType: 'arraybuffer',
            timeout: 10000
          });
          
          // Create temp file
          const tempDir = os.tmpdir();
          const tempFile = path.join(tempDir, `thumbnail_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`);
          fs.writeFileSync(tempFile, response.data);
          tempFiles.push(tempFile);
          
          // Upload media to mesh - use bot's auth token
          const apiClient = new RaveAPIClient("https://api.red.wemesh.ca", bot.authToken);
          const uploadedMedia = await uploadMedia(
            bot.roomId,
            [tempFile],
            false, // isExplicit
            apiClient
          );
          
          if (!uploadedMedia || uploadedMedia.length === 0) {
            // Fallback: send without thumbnail
            const title = videoInfo.title || "Unknown";
            const author = videoInfo.author || "Unknown";
            const messageText = `${title}\nby ${author}`;
            
            const sentMessageId = await bot.sendMessage(messageText);
            if (sentMessageId) {
              botWithVideoInfo.videoInfoMap.set(sentMessageId, videoInfo);
            }
            continue;
          }
          
          // Send message with uploaded media
          const mediaItem = uploadedMedia[0];
          const title = videoInfo.title || "Unknown";
          const author = videoInfo.author || "Unknown";
          const messageText = `${title}\nby ${author}`;
          
          const sentMessageId = await bot.sendMessage(messageText, undefined, [mediaItem]);
          if (sentMessageId) {
            botWithVideoInfo.videoInfoMap.set(sentMessageId, videoInfo);
            // Also update recentBotMessages
            const recentMsg = bot.recentBotMessages.find(m => m.id === sentMessageId);
            if (recentMsg) {
              (recentMsg as any).videoInfo = videoInfo;
            } else {
              // Add to recent messages if not found
              const lastMsg = bot.recentBotMessages[bot.recentBotMessages.length - 1];
              if (lastMsg && lastMsg.id === sentMessageId) {
                (lastMsg as any).videoInfo = videoInfo;
              }
            }
          }
        } catch (error: any) {
          console.error(`Error uploading thumbnail for ${videoInfo.title}:`, error);
          // Send without thumbnail
          const title = videoInfo.title || "Unknown";
          const author = videoInfo.author || "Unknown";
          const messageText = `${title}\nby ${author}`;
          
          const sentMessageId = await bot.sendMessage(messageText);
          if (sentMessageId) {
            botWithVideoInfo.videoInfoMap.set(sentMessageId, videoInfo);
          }
        }
      }
    } finally {
      // Cleanup temp files
      for (const tempFile of tempFiles) {
        try {
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    }
  } catch (error: any) {
    console.error(`Error searching for video:`, error);
    await bot.sendMessage(`❌ Error searching for video: ${error.message}`);
  }
}

/**
 * Find video info by reply message ID
 */
export function findVideoInfoByReply(bot: RaveBot, replyTo: string): VideoData | null {
  const botWithVideoInfo = bot as BotWithVideoInfo;
  
  if (!botWithVideoInfo.videoInfoMap) {
    return null;
  }
  
  // Check direct map
  const videoInfo = botWithVideoInfo.videoInfoMap.get(replyTo);
  if (videoInfo) {
    return videoInfo;
  }
  
  // Check if replyTo is a bot message ID
  if (!bot.botMessageIds.has(replyTo)) {
    return null;
  }
  
  // Check recent bot messages
  for (const msg of bot.recentBotMessages) {
    const msgId = msg.id;
    if (msgId === replyTo || (bot.botMessageIds.has(replyTo) && bot.botMessageIds.has(msgId))) {
      const videoInfo = (msg as any).videoInfo;
      if (videoInfo) {
        botWithVideoInfo.videoInfoMap.set(replyTo, videoInfo);
        return videoInfo;
      }
    }
  }
  
  // Check reversed recent messages
  for (const msg of [...bot.recentBotMessages].reverse()) {
    if ((msg as any).videoInfo && bot.botMessageIds.has(msg.id)) {
      const videoInfo = (msg as any).videoInfo;
      botWithVideoInfo.videoInfoMap.set(replyTo, videoInfo);
      return videoInfo;
    }
  }
  
  return null;
}

