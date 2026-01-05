/**
 * Truth/Dare API Utility
 * Fetches truth questions and dare challenges from truthordarebot.xyz API
 */

import axios from 'axios';

const API_BASE_URL = "https://api.truthordarebot.xyz/v1";

export type Rating = "PG" | "PG13" | "R";

export interface TruthDareResponse {
  question: string;
}

/**
 * Get a truth question
 * 
 * @param rating - Rating level: PG, PG13, or R (default: PG)
 * @returns Truth question text
 */
export async function getTruth(rating: Rating = "PG"): Promise<string> {
  try {
    const url = `${API_BASE_URL}/truth?rating=${rating}`;
    const response = await axios.get<TruthDareResponse>(url, { timeout: 5000 });
    
    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}`);
    }
    
    return response.data.question || "No question available";
  } catch (error: any) {
    throw new Error(`Failed to fetch truth question: ${error.message}`);
  }
}

/**
 * Get a dare challenge
 * 
 * @param rating - Rating level: PG, PG13, or R (default: PG)
 * @returns Dare challenge text
 */
export async function getDare(rating: Rating = "PG"): Promise<string> {
  try {
    const url = `${API_BASE_URL}/dare?rating=${rating}`;
    const response = await axios.get<TruthDareResponse>(url, { timeout: 5000 });
    
    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}`);
    }
    
    return response.data.question || "No dare available";
  } catch (error: any) {
    throw new Error(`Failed to fetch dare: ${error.message}`);
  }
}

