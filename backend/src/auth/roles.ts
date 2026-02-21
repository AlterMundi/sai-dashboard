import { DashboardRole } from '@/types';
import { appConfig } from '@/config';
import { logger } from '@/utils/logger';

/**
 * Extract the DashboardRole from Zitadel OIDC token claims.
 *
 * Zitadel stores project roles in the claim as an object:
 * { "urn:zitadel:iam:org:project:roles": { "SAI_ADMIN": { "<orgId>": "<orgName>" } } }
 *
 * The keys of the inner object are the role names.
 */
export function extractRole(claims: Record<string, unknown>): DashboardRole {
  const rolesClaim = appConfig.oidc.rolesClaim;
  const projectRoles = claims[rolesClaim];

  if (!projectRoles || typeof projectRoles !== 'object') {
    logger.warn('OIDC: No roles claim found in token', {
      claimsKeys: Object.keys(claims),
      rolesClaim,
    });
    throw new Error('USER_NO_ROLE');
  }

  const roleNames = Object.keys(projectRoles as Record<string, unknown>);

  logger.debug('OIDC: Found roles in claim', { roleNames });

  if (roleNames.includes('SAI_ADMIN')) return 'SAI_ADMIN';
  if (roleNames.includes('SAI_OPERATOR')) return 'SAI_OPERATOR';
  if (roleNames.includes('SAI_VIEWER')) return 'SAI_VIEWER';

  logger.warn('OIDC: User has roles but none are recognized', { roleNames });
  throw new Error('USER_NO_ROLE');
}
