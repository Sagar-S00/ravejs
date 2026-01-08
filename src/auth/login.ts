/**
 * Rave Login Module
 * Handles the complete Rave login flow
 * 
 * Login Flow:
 * 1. Request magic link from MojoAuth API
 * 2. Poll MojoAuth status until authenticated
 * 3. Get JWT token from MojoAuth
 * 4. Login to Parse with JWT token
 * 5. Authorize with Rave API using Parse credentials
 * 6. Final login to Rave API
 * 7. Generate auth token for subsequent requests
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import * as crypto from 'crypto';

export interface LoginResult {
  deviceId: string;
  ssaid: string;
  parseId: string;
  parseToken: string;
  authToken: string;
  userId?: number;
  peerId?: string;
}

/**
 * Handles the complete Rave login flow
 */
export class RaveLogin {
  // API Endpoints
  private static readonly MOJO_AUTH_API = "https://api.mojoauth.com";
  private static readonly PARSE_API = "https://api.soborol.com/parse";
  private static readonly RAVE_API = "https://api.red.wemesh.ca";
  
  // MojoAuth API Key (from source code)
  private static readonly MOJO_API_KEY = "45af6a2e-4c1c-45a5-9874-df1eb3a22fe2";
  
  // Request Hash Secret (from RequestHasher.java)
  private static readonly HASH_SECRET = "c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2";
  
  // Parse Application ID (from HTTP history)
  private static readonly PARSE_APP_ID = "83a03c48-0f97-4f01-8a80-f603ea2a2270";

  email: string;
  deviceId: string;
  ssaid: string;
  mojoStateId?: string;
  mojoJwtToken?: string;
  parseId?: string;
  parseToken?: string;
  authToken?: string;
  private session: AxiosInstance;

  constructor(email: string, deviceId?: string, ssaid?: string) {
    /**
     * Initialize Rave login client
     * 
     * @param email - User email address
     * @param deviceId - Device ID (generated if not provided)
     * @param ssaid - Android SSID (generated if not provided)
     */
    this.email = email;
    this.deviceId = deviceId || RaveLogin.generateDeviceId();
    this.ssaid = ssaid || RaveLogin.generateSsaid();
    this.session = axios.create({
      timeout: 30000,
      headers: {
        'Accept-Encoding': 'gzip, deflate, br'
      }
    });
  }

  /**
   * Generate a random device ID (32 hex characters)
   */
  private static generateDeviceId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate a random Android SSID (16 hex characters)
   */
  private static generateSsaid(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Generate current timestamp in milliseconds
   */
  private generateTimestamp(): number {
    return Date.now();
  }

  /**
   * Generate request hash using HMAC-SHA256
   * 
   * Format: {timestamp}:{token}:{contentLength}
   * 
   * @param token - Auth token to use in hash
   * @param contentLength - Request body content length
   * @returns Tuple of [hash_string, timestamp]
   */
  private generateRequestHash(token: string, contentLength: number = 0): [string, number] {
    const timestamp = this.generateTimestamp();
    const message = `${timestamp}:${token}:${contentLength}`;
    
    // Create HMAC-SHA256 hash
    const hmac = crypto.createHmac('sha256', RaveLogin.HASH_SECRET);
    hmac.update(message);
    const hashBytes = hmac.digest();
    
    // Base64 encode the hash
    const hashString = hashBytes.toString('base64');
    
    return [hashString, timestamp];
  }

  /**
   * Get common headers used in Rave API requests
   */
  private getCommonHeaders(): Record<string, string> {
    return {
      "Client-Version": "8.2.9",
      "Wemesh-Api-Version": "4.0",
      "Wemesh-Platform": "android",
      "User-Agent": "Rave/2149 (8.2.9) (Android 9; ASUS_X00TD; asus ASUS_X00T_2; en)",
      "Ssaid": this.ssaid,
      "Content-Type": "application/json; charset=UTF-8",
      "Accept-Encoding": "gzip, deflate, br"
    };
  }

  /**
   * Add authorization and request hash headers
   */
  private addAuthHeaders(headers: Record<string, string>, token: string, body: string = ""): Record<string, string> {
    const contentLength = body ? Buffer.byteLength(body, 'utf8') : 0;
    const [requestHash, timestamp] = this.generateRequestHash(token, contentLength);
    
    headers["Authorization"] = `Bearer ${token}`;
    headers["Request-Hash"] = requestHash;
    headers["Request-Ts"] = String(timestamp);
    return headers;
  }

  /**
   * Step 1: Request magic link from MojoAuth
   * 
   * @returns Response data containing state_id
   */
  async requestMagicLink(): Promise<Record<string, any>> {
    const url = `${RaveLogin.MOJO_AUTH_API}/users/magiclink`;
    const params = {
      language: "en",
      redirect_url: "https://rave.watch/mojoauth"
    };
    
    const headers = {
      "X-Api-Key": RaveLogin.MOJO_API_KEY,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "okhttp/5.1.0"
    };
    
    const payload = {
      email: this.email
    };
    
    console.log(`[1] Requesting magic link for ${this.email}...`);
    const response = await this.session.post(url, payload, { params, headers });
    
    const data = response.data;
    this.mojoStateId = data.state_id;
    console.log(`[1] Magic link sent! State ID: ${this.mojoStateId}`);
    console.log(`[1] Please check your email and click the magic link.`);
    
    return data;
  }

  /**
   * Step 2: Poll MojoAuth status until authenticated
   * 
   * @param maxAttempts - Maximum number of polling attempts (default: 300)
   * @param interval - Seconds between polling attempts (default: 2)
   * @returns User response data with JWT token
   */
  async pollMojoStatus(maxAttempts: number = 300, interval: number = 2): Promise<Record<string, any>> {
    if (!this.mojoStateId) {
      throw new Error("No state_id available. Call requestMagicLink() first.");
    }
    
    const url = `${RaveLogin.MOJO_AUTH_API}/users/status`;
    const params = { state_id: this.mojoStateId };
    
    const headers = {
      "X-Api-Key": RaveLogin.MOJO_API_KEY,
      "User-Agent": "okhttp/5.1.0"
    };
    
    console.log(`[2] Polling MojoAuth status (max ${maxAttempts} attempts)...`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await this.session.get(url, { params, headers });
      const data = response.data;
      const isAuthenticated = data.authenticated || false;
      
      if (isAuthenticated) {
        const oauth = data.oauth || {};
        this.mojoJwtToken = oauth.id_token;
        
        if (this.mojoJwtToken) {
          console.log(`[2] ✓ Authenticated! JWT token received.`);
          return data;
        } else {
          console.log(`[2] Authenticated but no token found. Retrying...`);
        }
      }
      
      if (attempt % 10 === 0) {
        console.log(`[2] Still waiting... (attempt ${attempt}/${maxAttempts})`);
      }
      
      await new Promise(resolve => setTimeout(resolve, interval * 1000));
    }
    
    throw new Error(`Authentication timeout after ${maxAttempts} attempts`);
  }

  /**
   * Step 3: Login to Parse using MojoAuth JWT token
   * 
   * @returns Parse user data with parseId and parseToken
   */
  async loginToParse(): Promise<Record<string, any>> {
    if (!this.mojoJwtToken) {
      throw new Error("No JWT token available. Complete MojoAuth authentication first.");
    }
    
    const url = `${RaveLogin.PARSE_API}/users`;
    
    const headers = {
      "X-Parse-Application-Id": RaveLogin.PARSE_APP_ID,
      "X-Parse-App-Build-Version": "2149",
      "X-Parse-App-Display-Version": "8.2.9",
      "X-Parse-Os-Version": "9",
      "User-Agent": "Parse Android SDK API Level 28",
      "Content-Type": "application/json"
    };
    
    // Extract identifier from JWT (email)
    const payload = {
      authData: {
        mojo: {
          id_token: this.mojoJwtToken,
          id: this.email
        }
      }
    };
    
    console.log(`[3] Logging into Parse with MojoAuth token...`);
    const response = await this.session.post(url, payload, { headers });
    
    const data = response.data;
    this.parseId = data.objectId;
    this.parseToken = data.sessionToken;
    
    if (!this.parseId || !this.parseToken) {
      throw new Error("Failed to get Parse credentials from response");
    }
    
    console.log(`[3] ✓ Parse login successful! Parse ID: ${this.parseId}`);
    return data;
  }

  /**
   * Step 4: Authorize with Rave API using Parse credentials
   * 
   * @param name - User name (defaults to email username)
   * @returns Authorization response
   */
  async authorizeWithRave(name?: string): Promise<Record<string, any>> {
    if (!this.parseId || !this.parseToken) {
      throw new Error("No Parse credentials available. Complete Parse login first.");
    }
    
    const url = `${RaveLogin.RAVE_API}/auth2/mojo/login`;
    
    // Extract name from email if not provided
    if (!name) {
      name = this.email.split("@")[0];
    }
    
    const headers = this.getCommonHeaders();
    
    // Parse token format: "r:token" -> just "token" for hash
    const tokenForHash = this.parseToken.startsWith("r:") 
      ? this.parseToken.substring(2) 
      : this.parseToken;
    
    const payload = {
      deviceId: this.deviceId,
      email: this.email,
      lang: "en",
      name: name,
      parseId: this.parseId,
      parseToken: this.parseToken,
      platId: this.email
    };
    
    const body = JSON.stringify(payload);
    const finalHeaders = this.addAuthHeaders(headers, tokenForHash, body);
    
    console.log(`[4] Authorizing with Rave API...`);
    const response = await this.session.post(url, payload, { headers: finalHeaders });
    
    const data = response.data;
    console.log(`[4] ✓ Authorization successful!`);
    return data;
  }

  /**
   * Step 5: Final login to Rave API
   * 
   * @returns Login response with auth token
   */
  async finalLogin(): Promise<Record<string, any>> {
    if (!this.parseToken) {
      throw new Error("No Parse token available. Complete authorization first.");
    }
    
    const url = `${RaveLogin.RAVE_API}/auth/login`;
    
    const headers = this.getCommonHeaders();
    
    // Parse token format: "r:token" -> just "token" for hash
    const tokenForHash = this.parseToken.startsWith("r:") 
      ? this.parseToken.substring(2) 
      : this.parseToken;
    
    const payload = {
      adId: RaveLogin.generateDeviceId(), // Different from deviceId
      carrierCountry: "US",
      deviceId: this.deviceId,
      lang: "en",
      storeCountry: "US"
    };
    
    const body = JSON.stringify(payload);
    const finalHeaders = this.addAuthHeaders(headers, tokenForHash, body);
    
    console.log(`[5] Performing final login...`);
    const response = await this.session.post(url, payload, { headers: finalHeaders });
    
    const data = response.data;
    
    // Extract auth token from response
    // The token might be in different fields depending on response structure
    if (typeof data === 'object' && data !== null) {
      this.authToken = (
        data.token || 
        data.authToken || 
        data.accessToken ||
        this.parseToken // Fallback to parse token
      ) as string;
    }
    
    console.log(`[5] ✓ Final login successful!`);
    return data;
  }

  /**
   * Step 6: Get user tokens (optional, for push notifications)
   * 
   * @returns Token registration response
   */
  async getUserTokens(): Promise<Record<string, any>> {
    if (!this.parseToken) {
      throw new Error("No auth token available. Complete login first.");
    }
    
    const url = `${RaveLogin.RAVE_API}/users/self/tokens`;
    
    const headers = this.getCommonHeaders();
    const tokenForHash = this.parseToken.startsWith("r:") 
      ? this.parseToken.substring(2) 
      : this.parseToken;
    
    // This would typically include FCM token, but we'll use a placeholder
    const payload = {
      deviceId: this.deviceId,
      platform: "android",
      token: "placeholder_fcm_token"
    };
    
    const body = JSON.stringify(payload);
    const finalHeaders = this.addAuthHeaders(headers, tokenForHash, body);
    
    console.log(`[6] Registering device token...`);
    const response = await this.session.post(url, payload, { headers: finalHeaders });
    
    const data = response.data;
    console.log(`[6] ✓ Token registered!`);
    return data;
  }

  /**
   * Complete login flow
   * 
   * @param waitForMagicLink - If true, polls for magic link completion. If false, returns after sending magic link.
   * @returns Login result with all credentials
   */
  async login(waitForMagicLink: boolean = true): Promise<LoginResult> {
    try {
      // Step 1: Request magic link
      await this.requestMagicLink();
      
      if (!waitForMagicLink) {
        console.log("\n[INFO] Magic link sent. Complete authentication in your email, then call:");
        console.log("  client.pollMojoStatus()");
        console.log("  client.loginToParse()");
        console.log("  client.authorizeWithRave()");
        console.log("  client.finalLogin()");
        throw new Error("Login incomplete - magic link not confirmed");
      }
      
      // Step 2: Poll for authentication
      await this.pollMojoStatus();
      
      // Step 3: Login to Parse
      await this.loginToParse();
      
      // Step 4: Authorize with Rave
      await this.authorizeWithRave();
      
      // Step 5: Final login
      await this.finalLogin();
      
      // Step 6: Register tokens (optional)
      try {
        await this.getUserTokens();
      } catch (error: any) {
        console.log(`[6] Token registration failed (non-critical): ${error.message}`);
      }
      
      console.log("\n" + "=".repeat(50));
      console.log("✓ LOGIN COMPLETE!");
      console.log("=".repeat(50));
      console.log(`Device ID: ${this.deviceId}`);
      console.log(`Parse ID: ${this.parseId}`);
      console.log(`Auth Token: ${this.authToken ? this.authToken.substring(0, 50) + "..." : "N/A"}`);
      console.log("=".repeat(50));
      
      // Try to get user ID from API to construct peerId
      // Format: {id}_{deviceId}
      let userId: number | undefined;
      let peerId: string | undefined;
      try {
        const tokenForHash = this.parseToken!.startsWith("r:") 
          ? this.parseToken!.substring(2) 
          : this.parseToken!;
        
        const headers = this.getCommonHeaders();
        const finalHeaders = this.addAuthHeaders(headers, tokenForHash, "");
        
        const userResponse = await this.session.get(
          `${RaveLogin.RAVE_API}/users/self`,
          { headers: finalHeaders }
        );
        
        // Response format: { "data": { "id": 122767990, ... } }
        const responseData = userResponse.data;
        const userData = responseData?.data || responseData;
        
        if (userData && userData.id) {
          userId = userData.id;
          peerId = `${userId}_${this.deviceId}`;
          console.log(`User ID: ${userId}, Peer ID: ${peerId}`);
        }
      } catch (error: any) {
        console.log(`Could not fetch user ID: ${error.message}`);
        // userId and peerId will remain undefined - user can provide it manually if needed
      }
      
      return {
        deviceId: this.deviceId,
        ssaid: this.ssaid,
        parseId: this.parseId!,
        parseToken: this.parseToken!,
        authToken: this.authToken || this.parseToken!,
        userId: userId,
        peerId: peerId
      };
      
    } catch (error: any) {
      console.log(`\n✗ Login failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the current auth token
   */
  getAuthToken(): string | undefined {
    return this.authToken || this.parseToken;
  }
}

