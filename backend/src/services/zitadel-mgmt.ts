/**
 * Zitadel Management API client.
 *
 * Uses client_credentials grant to obtain a short-lived access token,
 * then calls the Management API to assign project roles (user grants).
 *
 * Uses the global fetch API (Node 18+) — no additional HTTP library required.
 */
import { appConfig } from '@/config';
import { logger } from '@/utils/logger';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getMgmtToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && cachedToken.expiresAt > now + 30) {
    return cachedToken.value;
  }

  const issuer = appConfig.oidc.issuer;
  const tokenUrl = `${issuer}/oauth/v2/token`;

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'openid urn:zitadel:iam:org:project:id:zitadel:aud',
  });

  const credentials = Buffer.from(
    `${appConfig.oidc.mgmtClientId}:${appConfig.oidc.mgmtClientSecret}`
  ).toString('base64');

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Zitadel token request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as TokenResponse;
  const { access_token, expires_in } = data;

  cachedToken = {
    value: access_token,
    expiresAt: now + expires_in,
  };

  return access_token;
}

/**
 * Assign a project role to a user via the Zitadel Management API.
 * Creates a user grant for the configured project.
 */
export async function assignRole(userId: string, roleKey: string): Promise<void> {
  const token = await getMgmtToken();
  const issuer = appConfig.oidc.issuer;
  const projectId = appConfig.oidc.projectId;

  const url = `${issuer}/management/v1/users/${userId}/grants`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId, roleKeys: [roleKey] }),
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // ignore parse errors — use statusText fallback
    }
    logger.error('Zitadel: failed to assign role', {
      userId,
      roleKey,
      status: response.status,
      message,
    });
    throw new Error(`Failed to assign role in Zitadel: ${message}`);
  }

  logger.info('Zitadel: role assigned', { userId, roleKey, projectId });
}
