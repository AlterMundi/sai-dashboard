/**
 * Security tests for extractRole — Zitadel role extraction.
 *
 * These tests verify the project-scoped claim isolation that prevents
 * cross-application role bleed in shared Zitadel instances.
 */

// Mock @/config before any module imports so that the config validation
// (which calls process.exit on missing env vars) never runs.
// We control appConfig.oidc.projectId directly in each test suite.

const PROJECT_ID = 'sai-project-id-123';
const PROJECT_CLAIM_KEY = `urn:zitadel:iam:org:project:id:${PROJECT_ID}:roles`;
const GENERIC_CLAIM_KEY = 'urn:zitadel:iam:org:project:roles';

// Shared mock so we can mutate projectId between suites
const mockOidcConfig = { projectId: PROJECT_ID };

jest.mock('@/config', () => ({
  appConfig: {
    oidc: mockOidcConfig,
  },
}));

// Also mock the logger to suppress output
jest.mock('@/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('extractRole — project-scoped claim isolation', () => {
  describe('when ZITADEL_PROJECT_ID is configured', () => {
    beforeEach(() => {
      mockOidcConfig.projectId = PROJECT_ID;
      jest.resetModules();
      // Re-apply mocks after resetModules
      jest.mock('@/config', () => ({
        appConfig: { oidc: { projectId: PROJECT_ID } },
      }));
      jest.mock('@/utils/logger', () => ({
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      }));
    });

    it('returns SAI_ADMIN from the project-scoped claim', async () => {
      const { extractRole } = await import('../roles');
      const claims = {
        [PROJECT_CLAIM_KEY]: { SAI_ADMIN: { orgId: 'orgName' } },
      };
      expect(extractRole(claims)).toBe('SAI_ADMIN');
    });

    it('returns SAI_OPERATOR from the project-scoped claim', async () => {
      const { extractRole } = await import('../roles');
      const claims = {
        [PROJECT_CLAIM_KEY]: { SAI_OPERATOR: { orgId: 'orgName' } },
      };
      expect(extractRole(claims)).toBe('SAI_OPERATOR');
    });

    it('returns SAI_VIEWER from the project-scoped claim', async () => {
      const { extractRole } = await import('../roles');
      const claims = {
        [PROJECT_CLAIM_KEY]: { SAI_VIEWER: { orgId: 'orgName' } },
      };
      expect(extractRole(claims)).toBe('SAI_VIEWER');
    });

    it('SAI_ADMIN wins over SAI_OPERATOR when both present', async () => {
      const { extractRole } = await import('../roles');
      const claims = {
        [PROJECT_CLAIM_KEY]: {
          SAI_OPERATOR: { orgId: 'orgName' },
          SAI_ADMIN: { orgId: 'orgName' },
        },
      };
      expect(extractRole(claims)).toBe('SAI_ADMIN');
    });

    it('SAI_OPERATOR wins over SAI_VIEWER when both present', async () => {
      const { extractRole } = await import('../roles');
      const claims = {
        [PROJECT_CLAIM_KEY]: {
          SAI_VIEWER: { orgId: 'orgName' },
          SAI_OPERATOR: { orgId: 'orgName' },
        },
      };
      expect(extractRole(claims)).toBe('SAI_OPERATOR');
    });

    /**
     * SECURITY: Cross-project role bleed prevention.
     *
     * A user is SAI_ADMIN in ANOTHER Zitadel application. The generic claim
     * carries their SAI_ADMIN role from that other app. They have NO
     * project-scoped claim for THIS project.
     *
     * extractRole must NOT fall back to the generic claim — it must throw.
     * If it falls back, the user is granted SAI_ADMIN access to this
     * application they have no rights to. This is the actual security bug.
     */
    it('throws USER_NO_ROLE when project-scoped claim is absent but generic claim has a recognized SAI role (cross-app bleed)', async () => {
      const { extractRole } = await import('../roles');
      const claims = {
        // Project-scoped claim for our project is ABSENT
        // Generic claim has SAI_ADMIN from ANOTHER application
        [GENERIC_CLAIM_KEY]: { SAI_ADMIN: { orgId: 'orgName' } },
      };
      expect(() => extractRole(claims)).toThrow('USER_NO_ROLE');
    });

    /**
     * Variant: foreign app role that is not a SAI role.
     * Even with an unrecognized foreign role, must not fall back.
     */
    it('throws USER_NO_ROLE when project-scoped claim is absent and generic claim has only unrecognized foreign roles', async () => {
      const { extractRole } = await import('../roles');
      const claims = {
        [GENERIC_CLAIM_KEY]: { ADMIN: { orgId: 'orgName' } },
      };
      expect(() => extractRole(claims)).toThrow('USER_NO_ROLE');
    });

    it('throws USER_NO_ROLE when project-scoped claim exists but has only unrecognized roles', async () => {
      const { extractRole } = await import('../roles');
      const claims = {
        [PROJECT_CLAIM_KEY]: { ADMIN: { orgId: 'orgName' } }, // not a SAI_* role
      };
      expect(() => extractRole(claims)).toThrow('USER_NO_ROLE');
    });

    it('throws USER_NO_ROLE when no claims at all', async () => {
      const { extractRole } = await import('../roles');
      expect(() => extractRole({})).toThrow('USER_NO_ROLE');
    });
  });

  describe('when ZITADEL_PROJECT_ID is NOT configured (empty string)', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.mock('@/config', () => ({
        appConfig: { oidc: { projectId: '' } },
      }));
      jest.mock('@/utils/logger', () => ({
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      }));
    });

    it('falls back to the generic claim and returns SAI_ADMIN', async () => {
      const { extractRole } = await import('../roles');
      const claims = {
        [GENERIC_CLAIM_KEY]: { SAI_ADMIN: { orgId: 'orgName' } },
      };
      expect(extractRole(claims)).toBe('SAI_ADMIN');
    });

    it('throws USER_NO_ROLE when generic claim has only unrecognized roles', async () => {
      const { extractRole } = await import('../roles');
      const claims = {
        [GENERIC_CLAIM_KEY]: { ADMIN: { orgId: 'orgName' } },
      };
      expect(() => extractRole(claims)).toThrow('USER_NO_ROLE');
    });
  });
});
