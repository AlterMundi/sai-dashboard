import { useAuth } from '@/hooks/useAuth';
import { DashboardRole } from '@/types';

interface RoleGateProps {
  roles: DashboardRole[];
  children: React.ReactNode;
}

export function RoleGate({ roles, children }: RoleGateProps) {
  const { user } = useAuth();

  if (!user || !roles.includes(user.role)) {
    return null;
  }

  return <>{children}</>;
}
