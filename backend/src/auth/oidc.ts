import { Issuer, generators, Client, TokenSet, ClientMetadata } from 'openid-client';
import { appConfig } from '@/config';
import { logger } from '@/utils/logger';

let oidcClient: Client | null = null;

/**
 * Initialize the OIDC client by discovering the issuer metadata.
 * Must be called once at startup. Result is cached.
 */
export async function initOIDCClient(): Promise<Client> {
  if (oidcClient) return oidcClient;

  logger.info(`OIDC: Discovering issuer at ${appConfig.oidc.issuer}`);

  const issuer = await Issuer.discover(appConfig.oidc.issuer);

  logger.info(`OIDC: Discovered issuer ${issuer.issuer}`);
  logger.info(`OIDC: Authorization endpoint: ${issuer.metadata.authorization_endpoint}`);

  const clientConfig: ClientMetadata = {
    client_id: appConfig.oidc.clientId,
    redirect_uris: [appConfig.oidc.redirectUri],
    response_types: ['code'],
  };

  if (appConfig.oidc.clientSecret) {
    clientConfig.client_secret = appConfig.oidc.clientSecret;
    clientConfig.token_endpoint_auth_method = 'client_secret_basic';
  } else {
    clientConfig.token_endpoint_auth_method = 'none';
  }

  oidcClient = new issuer.Client(clientConfig);

  logger.info('OIDC: Client initialized successfully');

  return oidcClient;
}

/**
 * Get the cached OIDC client (must have been initialized first)
 */
export function getOIDCClient(): Client {
  if (!oidcClient) {
    throw new Error('OIDC client not initialized. Call initOIDCClient() first.');
  }
  return oidcClient;
}

/**
 * Generate PKCE parameters and build the authorization URL.
 * Returns the URL to redirect the user to, plus the state/verifier to store in cookies.
 */
export function buildAuthorizationUrl(params: {
  state: string;
  codeChallenge: string;
}): URL {
  const client = getOIDCClient();

  const authUrl = client.authorizationUrl({
    scope: 'openid email profile urn:zitadel:iam:org:project:roles',
    redirect_uri: appConfig.oidc.redirectUri,
    response_type: 'code',
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  });

  return new URL(authUrl);
}

/**
 * Generate a fresh state + codeVerifier for a new OIDC flow.
 */
export function generatePKCEParams(): { state: string; codeVerifier: string; codeChallenge: string } {
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();
  return { state, codeVerifier, codeChallenge };
}

/**
 * Exchange the authorization code for tokens, validating PKCE and state.
 * Returns the TokenSet with ID token + access token.
 */
export async function exchangeCode(params: {
  callbackUrl: string;
  storedState: string;
  codeVerifier: string;
}): Promise<TokenSet> {
  const client = getOIDCClient();

  const callbackParams = client.callbackParams(params.callbackUrl);

  const tokenSet = await client.callback(
    appConfig.oidc.redirectUri,
    callbackParams,
    {
      state: params.storedState,
      code_verifier: params.codeVerifier,
    }
  );

  return tokenSet;
}

/**
 * Build the Zitadel end_session URL for logout.
 */
export function buildLogoutUrl(idTokenHint?: string): URL {
  const client = getOIDCClient();

  const logoutUrl = client.endSessionUrl({
    post_logout_redirect_uri: appConfig.oidc.postLogoutUri,
    ...(idTokenHint ? { id_token_hint: idTokenHint } : {}),
  });

  return new URL(logoutUrl);
}
