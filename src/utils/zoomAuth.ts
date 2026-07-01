/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosResponse } from "axios";

let cachedToken: string | null = null;
let tokenExpiry: number | null = null;

interface ZoomTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export function clearZoomTokenCache(): void {
  cachedToken = null;
  tokenExpiry = null;
}

export async function getZoomAccessToken(
  options?: { forceRefresh?: boolean },
): Promise<string> {
  const forceRefresh = Boolean(options?.forceRefresh);
  // Return cached token when valid
  if (!forceRefresh && cachedToken && tokenExpiry && tokenExpiry > Date.now()) {
    return cachedToken;
  }

  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    throw new Error("Zoom OAuth environment variables are missing.");
  }

  const tokenUrl = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`;

  const authString = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const response: AxiosResponse<ZoomTokenResponse> = await axios.post(
    tokenUrl,
    null,
    {
      headers: {
        Authorization: `Basic ${authString}`,
      },
    }
  );

  cachedToken = response.data.access_token;
  tokenExpiry = Date.now() + response.data.expires_in * 1000;
  console.log("[ZoomAuth] Token refreshed. Scope:", response.data.scope);

  return cachedToken;
}
