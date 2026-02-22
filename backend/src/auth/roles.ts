import { DashboardRole } from '@/types';
import { appConfig } from '@/config';
import { logger } from '@/utils/logger';

/**
 * Extract the DashboardRole from Zitadel OIDC token claims.
 *
 * Uses the project-scoped claim `urn:zitadel:iam:org:project:id:<projectId>:roles`
 * when ZITADEL_PROJECT_ID is configured, preventing cross-project role bleed
 * in shared Zitadel instances.
 *
 * Falls back to the generic `urn:zitadel:iam:org:project:roles` claim only if
 * ZITADEL_PROJECT_ID is not set.
 */
export function extractRole(claims: Record<string, unknown>): DashboardRole {
  const projectId = appConfig.oidc.projectId;
  const genericClaimKey = 'urn:zitadel:iam:org:project:roles';
  const projectClaimKey = projectId
    ? `urn:zitadel:iam:org:project:id:${projectId}:roles`
    : null;

  // Prefer project-scoped claim; fall back to generic if projectId not configured
  const claimKey = projectClaimKey ?? genericClaimKey;
  const projectRoles = claims[claimKey] ?? (projectClaimKey ? claims[genericClaimKey] : undefined);

  if (!projectRoles || typeof projectRoles !== 'object') {
    logger.warn('OIDC: No roles claim found in token', {
      claimsKeys: Object.keys(claims),
      claimKeyAttempted: claimKey,
    });
    throw new Error('USER_NO_ROLE');
  }

  const roleNames = Object.keys(projectRoles as Record<string, unknown>);
  logger.debug('OIDC: Found roles in claim', { roleNames, claimKey });

  // Highest-privilege wins
  if (roleNames.includes('SAI_ADMIN')) return 'SAI_ADMIN';
  if (roleNames.includes('SAI_OPERATOR')) return 'SAI_OPERATOR';
  if (roleNames.includes('SAI_VIEWER')) return 'SAI_VIEWER';

  logger.warn('OIDC: User has roles but none are recognized for this project', {
    roleNames,
    claimKey,
  });
  throw new Error('USER_NO_ROLE');
}
