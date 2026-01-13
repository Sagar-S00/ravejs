/**
 * Rave API Client Module
 * Handles all API requests with automatic header generation and request hash signing
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import * as crypto from 'crypto';

/**
 * Rave API Client
 * 
 * Automatically handles:
 * - Request-Hash generation
 * - Request-Ts (timestamp) generation
 * - All required headers
 * - Request signing
 */
export class RaveAPIClient {
  // Secret key for HMAC-SHA256 hash generation (from RequestHasher.java)
  private static readonly SECRET_KEY = "c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2";

  private _baseUrl: string;
  private authToken: string;
  private clientVersion: string;
  private apiVersion: string;
  private platform: string;
  private userAgent: string;
  private ssaid: string;
  private session: AxiosInstance;

  constructor(
    baseUrl: string = "https://api.red.wemesh.ca",
    authToken: string = "",
    clientVersion: string = "8.2.9",
    apiVersion: string = "4.0",
    platform: string = "android",
    userAgent: string = "Rave/2149 (8.2.9) (Android 9; ASUS_X00TD; asus ASUS_X00T_2; en)",
    ssaid: string = "b32a05e5c198bdc0"
  ) {
    /**
     * Initialize Rave API Client
     * 
     * @param baseUrl - Base URL for the API (default: https://api.red.wemesh.ca)
     * @param authToken - Bearer token for authentication
     * @param clientVersion - Client version (default: 8.2.9)
     * @param apiVersion - API version (default: 4.0)
     * @param platform - Platform name (default: android)
     * @param userAgent - User-Agent string
     * @param ssaid - SSaid header value
     */
    this._baseUrl = baseUrl.replace(/\/+$/, ''); // Remove trailing slashes
    this.authToken = authToken;
    this.clientVersion = clientVersion;
    this.apiVersion = apiVersion;
    this.platform = platform;
    this.userAgent = userAgent;
    this.ssaid = ssaid;

    // Create axios instance for connection pooling
    this.session = axios.create({
      timeout: 15000,
      headers: {
        'Accept-Encoding': 'gzip, deflate, br'
      }
    });
  }

  /**
   * Generate Request-Hash using HMAC-SHA256
   * 
   * Based on RequestHasher.generateHash() from the Android app.
   * Format: HMAC-SHA256("{timestamp}:{token}:{contentLength}")
   * 
   * @param timestamp - Request timestamp in milliseconds
   * @param token - Auth token
   * @param contentLength - Content length of request body
   * @returns Base64 encoded hash
   */
  private generateRequestHash(timestamp: number, token: string, contentLength: number): string {
    const inputString = `${timestamp}:${token}:${contentLength}`;

    // Create HMAC-SHA256
    const hmac = crypto.createHmac('sha256', RaveAPIClient.SECRET_KEY);
    hmac.update(inputString);
    const hashBytes = hmac.digest();

    // Get Base64 encoded result (NO_WRAP = no padding/newlines)
    const hashBase64 = hashBytes.toString('base64');

    return hashBase64;
  }

  /**
   * Generate current timestamp in milliseconds
   * 
   * @returns Timestamp in milliseconds
   */
  private generateTimestamp(): number {
    return Date.now();
  }

  /**
   * Strip "r:" prefix from token if present
   * Parse tokens may have "r:" prefix that needs to be removed for API usage
   * 
   * @param token - Token string (may have "r:" prefix)
   * @returns Token without "r:" prefix
   */
  private normalizeToken(token: string): string {
    return token.startsWith("r:") ? token.substring(2) : token;
  }

  /**
   * Build request headers with automatic hash generation
   * 
   * @param method - HTTP method (GET, POST, DELETE, etc.)
   * @param payload - Request payload (object or string)
   * @param customHeaders - Additional custom headers to include
   * @returns Dictionary of headers
   */
  private buildHeaders(
    method: string,
    payload?: any,
    customHeaders?: Record<string, string>
  ): Record<string, string> {
    // Calculate content length
    // If payload is already a string (serialized JSON), use its length directly
    // Otherwise serialize it (for objects) or convert to string
    let contentLength = 0;
    if (payload !== undefined && payload !== null) {
      if (typeof payload === 'string') {
        // Already serialized - use byte length for accuracy
        contentLength = Buffer.byteLength(payload, 'utf8');
      } else if (typeof payload === 'object') {
        // Use byte length to match exactly what will be sent over the wire
        contentLength = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      } else {
        contentLength = Buffer.byteLength(String(payload), 'utf8');
      }
    }
    
    return this.buildHeadersWithContentLength(method, contentLength, payload, customHeaders);
  }

  /**
   * Build request headers with a pre-calculated content length
   * 
   * @param method - HTTP method (GET, POST, DELETE, etc.)
   * @param contentLength - Pre-calculated content length in bytes
   * @param payload - Request payload (for Content-Type detection)
   * @param customHeaders - Additional custom headers to include
   * @returns Dictionary of headers
   */
  private buildHeadersWithContentLength(
    method: string,
    contentLength: number,
    payload?: any,
    customHeaders?: Record<string, string>
  ): Record<string, string> {

    // Normalize token (remove "r:" prefix if present)
    const normalizedToken = this.normalizeToken(this.authToken);

    // Generate timestamp and hash (use normalized token for hash)
    const timestamp = this.generateTimestamp();
    const requestHash = this.generateRequestHash(timestamp, normalizedToken, contentLength);

    // Extract host from base URL
    const host = this._baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

    // Build base headers (use normalized token in Authorization header)
    const headers: Record<string, string> = {
      "Host": host,
      "Client-Version": this.clientVersion,
      "Wemesh-Api-Version": this.apiVersion,
      "Wemesh-Platform": this.platform,
      "User-Agent": this.userAgent,
      "Ssaid": this.ssaid,
      "Authorization": `Bearer ${normalizedToken}`,
      "Request-Hash": requestHash,
      "Request-Ts": String(timestamp),
      "Accept-Encoding": "gzip, deflate, br"
    };

    // Add Content-Type for requests with body
    if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) && payload !== undefined && payload !== null) {
      headers["Content-Type"] = "application/json; charset=UTF-8";
    }

    // Merge custom headers (custom headers take precedence)
    if (customHeaders) {
      Object.assign(headers, customHeaders);
    }

    return headers;
  }

  /**
   * Send GET request
   * 
   * @param endpoint - API endpoint (e.g., "/meshes/{mesh-id}")
   * @param params - Query parameters
   * @param headers - Additional custom headers
   * @param timeout - Request timeout in seconds
   * @returns Response object
   */
  async get(
    endpoint: string,
    params?: Record<string, any>,
    headers?: Record<string, string>,
    timeout: number = 15
  ): Promise<AxiosResponse> {
    const url = `${this._baseUrl}${endpoint}`;
    const requestHeaders = this.buildHeaders("GET", undefined, headers);

    const config: AxiosRequestConfig = {
      headers: requestHeaders,
      params: params,
      timeout: timeout * 1000
    };

    const response = await this.session.get(url, config);
    return response;
  }

  /**
   * Get the base URL (for logging/debugging)
   */
  get baseUrl(): string {
    return this._baseUrl;
  }

  /**
   * Send POST request
   * 
   * @param endpoint - API endpoint (e.g., "/meshes/{mesh-id}/kick")
   * @param payload - Request body (object or string)
   * @param headers - Additional custom headers
   * @param timeout - Request timeout in seconds
   * @returns Response object
   */
  async post(
    endpoint: string,
    payload?: any,
    headers?: Record<string, string>,
    timeout: number = 15
  ): Promise<AxiosResponse> {
    const url = `${this._baseUrl}${endpoint}`;
    
    // Calculate content length using Buffer.byteLength to match exactly what will be sent
    // This is critical - the hash must use the exact byte length of the JSON string
    let contentLengthForHash = 0;
    if (payload !== undefined && payload !== null) {
      if (typeof payload === 'object') {
        // Serialize and get byte length - this must match what axios sends
        const jsonString = JSON.stringify(payload);
        contentLengthForHash = Buffer.byteLength(jsonString, 'utf8');
      } else {
        contentLengthForHash = Buffer.byteLength(String(payload), 'utf8');
      }
    }
    
    // Build headers with the pre-calculated content length
    const requestHeaders = this.buildHeadersWithContentLength("POST", contentLengthForHash, payload, headers);

    const config: AxiosRequestConfig = {
      headers: requestHeaders,
      timeout: timeout * 1000
    };

    // Pass the object to axios - it will serialize using JSON.stringify internally
    const response = await this.session.post(url, payload, config);
    return response;
  }

  /**
   * Send PUT request
   * 
   * @param endpoint - API endpoint
   * @param payload - Request body (object or string)
   * @param headers - Additional custom headers
   * @param timeout - Request timeout in seconds
   * @returns Response object
   */
  async put(
    endpoint: string,
    payload?: any,
    headers?: Record<string, string>,
    timeout: number = 15
  ): Promise<AxiosResponse> {
    const url = `${this._baseUrl}${endpoint}`;
    const requestHeaders = this.buildHeaders("PUT", payload, headers);

    const config: AxiosRequestConfig = {
      headers: requestHeaders,
      timeout: timeout * 1000
    };

    const response = await this.session.put(url, payload, config);
    return response;
  }

  /**
   * Send DELETE request
   * 
   * @param endpoint - API endpoint
   * @param params - Query parameters
   * @param headers - Additional custom headers
   * @param timeout - Request timeout in seconds
   * @returns Response object
   */
  async delete(
    endpoint: string,
    params?: Record<string, any>,
    headers?: Record<string, string>,
    timeout: number = 15
  ): Promise<AxiosResponse> {
    const url = `${this._baseUrl}${endpoint}`;
    const requestHeaders = this.buildHeaders("DELETE", undefined, headers);

    const config: AxiosRequestConfig = {
      headers: requestHeaders,
      params: params,
      timeout: timeout * 1000
    };

    const response = await this.session.delete(url, config);
    return response;
  }

  /**
   * Send PATCH request
   * 
   * @param endpoint - API endpoint
   * @param payload - Request body (object or string)
   * @param headers - Additional custom headers
   * @param timeout - Request timeout in seconds
   * @returns Response object
   */
  async patch(
    endpoint: string,
    payload?: any,
    headers?: Record<string, string>,
    timeout: number = 15
  ): Promise<AxiosResponse> {
    const url = `${this._baseUrl}${endpoint}`;
    const requestHeaders = this.buildHeaders("PATCH", payload, headers);

    const config: AxiosRequestConfig = {
      headers: requestHeaders,
      timeout: timeout * 1000
    };

    const response = await this.session.patch(url, payload, config);
    return response;
  }

  /**
   * Close the session
   */
  close(): void {
    // Axios doesn't have an explicit close method, but we can clear interceptors if needed
    // The instance will be garbage collected when no longer referenced
  }
}

