/**
 * Zitadel Management API client.
 *
 * Authenticates via JWT bearer grant (private key JSON file) to obtain a
 * short-lived access token, then calls the Management API to assign project
 * roles (user grants).
 *
 * Docs: https://zitadel.com/docs/guides/integrate/service-users/private-key-jwt
 */
import jwt from 'jsonwebtoken';
import { appConfig } from '@/config';
import { logger } from '@/utils/logger';

interface ZitadelKeyFile {
  type: string;
  keyId: string;
  key: string;    // RSA private key PEM
  userId: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

function parseKeyFile(): ZitadelKeyFile {
  const raw = appConfig.oidc.mgmtKeyJson;
  if (!raw) {
    throw new Error('ZITADEL_MGMT_KEY_JSON is not configured');
  }
  return JSON.parse(raw) as ZitadelKeyFile;
}

async function getMgmtToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && cachedToken.expiresAt > now + 30) {
    return cachedToken.value;
  }

  const keyFile = parseKeyFile();
  const issuer = appConfig.oidc.issuer;

  // Build the JWT assertion signed with the service account's RSA private key
  const assertion = jwt.sign(
    {
      iss: keyFile.userId,
      sub: keyFile.userId,
      aud: issuer,
      iat: now,
      exp: now + 3600,
    },
    keyFile.key,
    { algorithm: 'RS256', keyid: keyFile.keyId }
  );

  const tokenUrl = `${issuer}/oauth/v2/token`;
  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
    scope: 'openid urn:zitadel:iam:org:project:id:zitadel:aud',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Zitadel token request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as TokenResponse;

  cachedToken = {
    value: data.access_token,
    expiresAt: now + data.expires_in,
  };

  return data.access_token;
}

interface UserGrantListResponse {
  result?: Array<{ id: string; projectId: string; roleKeys: string[] }>;
}

/**
 * Find an existing user grant for the configured project.
 * Returns the grant ID if found, null otherwise.
 */
async function findExistingGrant(
  token: string,
  issuer: string,
  userId: string,
  projectId: string,
): Promise<string | null> {
  // Zitadel Management API v1: global usergrants search with userId + projectId filters
  const url = `${issuer}/management/v1/usergrants/_search`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      queries: [
        { userIdQuery: { userId } },
        { projectIdQuery: { projectId } },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logger.error('Zitadel: failed to search user grants', {
      userId, projectId, status: response.status, body: text,
    });
    return null;
  }

  const data = (await response.json()) as UserGrantListResponse;
  logger.debug('Zitadel: user grants search result', { userId, grants: data.result });
  const grant = data.result?.find((g) => g.projectId === projectId);
  return grant?.id ?? null;
}

/**
 * Assign a project role to a user via the Zitadel Management API.
 * Creates a user grant for the configured project, or updates the existing one
 * if a grant already exists (409 Conflict).
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

  // 409 means a grant already exists for this project — update it instead
  if (response.status === 409) {
    logger.info('Zitadel: grant already exists, updating', { userId, roleKey, projectId });

    const grantId = await findExistingGrant(token, issuer, userId, projectId);
    if (!grantId) {
      throw new Error('Failed to assign role in Zitadel: grant exists but could not retrieve grant ID');
    }

    const updateUrl = `${issuer}/management/v1/users/${userId}/grants/${grantId}`;
    const updateResponse = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roleKeys: [roleKey] }),
    });

    if (!updateResponse.ok) {
      let message = updateResponse.statusText;
      try {
        const body = (await updateResponse.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        // ignore parse errors
      }
      logger.error('Zitadel: failed to update existing grant', { userId, roleKey, grantId, status: updateResponse.status, message });
      throw new Error(`Failed to update role in Zitadel: ${message}`);
    }

    logger.info('Zitadel: existing grant updated', { userId, roleKey, projectId, grantId });
    return;
  }

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
