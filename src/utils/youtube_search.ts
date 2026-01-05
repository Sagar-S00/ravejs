/**
 * YouTube Search Module
 * TypeScript port of the Python youtube_search.py module
 */

import axios, { AxiosInstance } from 'axios';

// =========================
// CONFIG
// =========================

const API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const CLIENT_VERSION = "2.20231030.00.00";

const SEARCH_URL = "https://www.youtube.com/youtubei/v1/search";
const PLAYER_URL = "https://www.youtube.com/youtubei/v1/player";

const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/120.0.0.0 Safari/537.36"
  )
};

// =========================
// TYPES
// =========================

export interface VideoData {
  author: string | null;
  description: string | null;
  duration: string;
  isLive: boolean;
  maturity: string;
  providerId: string;
  thumbnail: string | null;
  thumbnails: {
    animated: null;
    channel: null;
    high: string;
  } | null;
  title: string | null;
  url: string;
  videoTags: string[];
  viewCount: number;
}

interface SearchVideoData {
  videoId: string;
  title: string | null;
  author: string | null;
  url: string;
  thumbnail: string | null;
  thumbnails: any;
  isLive: boolean;
  viewCountText: string | null;
}

interface PlayerData {
  description: string | null;
  videoTags: string[];
  duration: string;
  viewCount: number;
  maturity: string;
}

// =========================
// HELPERS
// =========================

function getText(obj: any): string | null {
  if (!obj) {
    return null;
  }
  if (obj.simpleText) {
    return obj.simpleText;
  }
  if (obj.runs && Array.isArray(obj.runs)) {
    return obj.runs.map((r: any) => r.text || "").join("");
  }
  return null;
}

function parseViewCount(text: string | null): number {
  if (!text) {
    return 0;
  }
  return parseInt(text.replace(/[^\d]/g, ""), 10) || 0;
}

function secondsToIso(seconds: number): string {
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `PT${h}H${m}M${s}S`;
}

// =========================
// SEARCH API
// =========================

async function searchYoutube(query: string, limit: number = 3): Promise<SearchVideoData[]> {
  const body = {
    query: query,
    params: "EgIQAQ%3D%3D", // videos only
    context: {
      client: {
        clientName: "WEB",
        clientVersion: CLIENT_VERSION
      }
    }
  };

  const url = `${SEARCH_URL}?key=${API_KEY}&prettyPrint=false`;
  const response = await axios.post(url, body, { headers: HEADERS, timeout: 10000 });
  
  if (response.status !== 200) {
    throw new Error(`YouTube search failed: ${response.status}`);
  }

  const data = response.data;

  const sections = (
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || []
  );

  const results: SearchVideoData[] = [];
  for (const section of sections) {
    const itemSection = section?.itemSectionRenderer;
    if (!itemSection) {
      continue;
    }

    for (const item of itemSection.contents || []) {
      if (item.videoRenderer) {
        const videoData = extractSearchVideo(item.videoRenderer);
        results.push(videoData);
        if (results.length >= limit) {
          return results;
        }
      }
    }
  }

  if (results.length === 0) {
    throw new Error("No video results found");
  }
  return results;
}

function extractSearchVideo(vr: any): SearchVideoData {
  const thumbs = vr?.thumbnail?.thumbnails || [];
  const bestThumb = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : null;

  const badges = vr.badges || [];
  const badgesStr = JSON.stringify(badges);
  const isLive = badgesStr.includes("LIVE");

  return {
    videoId: vr.videoId || "",
    title: getText(vr.title),
    author: getText(vr.ownerText),
    url: `https://www.youtube.com/watch?v=${vr.videoId || ""}`,
    thumbnail: bestThumb,
    thumbnails: vr.thumbnail,
    isLive: isLive,
    viewCountText: getText(vr.viewCountText)
  };
}

// =========================
// PLAYER API
// =========================

async function getPlayerData(videoId: string): Promise<any> {
  const body = {
    videoId: videoId,
    context: {
      client: {
        clientName: "WEB",
        clientVersion: CLIENT_VERSION
      }
    }
  };

  const url = `${PLAYER_URL}?key=${API_KEY}&prettyPrint=false`;
  const response = await axios.post(url, body, { headers: HEADERS, timeout: 10000 });
  
  if (response.status !== 200) {
    throw new Error(`YouTube player API failed: ${response.status}`);
  }
  
  return response.data;
}

function extractPlayerData(player: any): PlayerData {
  const details = player?.videoDetails || {};
  const micro = player?.microformat?.playerMicroformatRenderer || {};

  return {
    description: details.shortDescription || null,
    videoTags: details.keywords || [],
    duration: secondsToIso(parseInt(details.lengthSeconds || "0", 10)),
    viewCount: parseInt(details.viewCount || "0", 10),
    maturity: micro.isFamilySafe !== false ? "G" : "18+"
  };
}

// =========================
// MAIN MODULE FUNCTION
// =========================

/**
 * Search YouTube for videos and return complete video metadata.
 * 
 * @param query - Search query string
 * @param limit - Maximum number of results to return (default: 3)
 * @returns List of complete video data objects
 */
export async function searchAndGetVideoData(
  query: string,
  limit: number = 3
): Promise<VideoData[]> {
  // Search for videos
  const searchResults = await searchYoutube(query, limit);
  
  const finalResults: VideoData[] = [];
  for (const searchData of searchResults) {
    // Get detailed player data
    const playerData = await getPlayerData(searchData.videoId);
    const playerFields = extractPlayerData(playerData);
    
    // Merge all data into final result
    // Format thumbnails as expected by API: {animated: null, channel: null, high: url} or null
    const thumbnailUrl = searchData.thumbnail;
    const thumbnailsObj = thumbnailUrl ? {
      animated: null,
      channel: null,
      high: thumbnailUrl
    } : null;
    
    const finalData: VideoData = {
      author: searchData.author,
      description: playerFields.description,
      duration: playerFields.duration,
      isLive: searchData.isLive,
      maturity: playerFields.maturity,
      providerId: searchData.videoId,
      thumbnail: thumbnailUrl,
      thumbnails: thumbnailsObj,
      title: searchData.title,
      url: searchData.url,
      videoTags: playerFields.videoTags,
      viewCount: playerFields.viewCount
    };
    
    finalResults.push(finalData);
  }
  
  return finalResults;
}

