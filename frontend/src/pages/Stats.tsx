import { Layout } from '@/components/Layout';
import { StatsDashboard } from '@/components/StatsDashboard';
import { AdminPanel } from '@/components/AdminPanel';
import { RoleGate } from '@/components/RoleGate';
import { useTranslation } from '@/contexts/LanguageContext';

export function Stats() {
  const { t } = useTranslation();
  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t('stats.title')}</h1>
          <p className="mt-2 text-gray-600">
            {t('stats.subtitle')}
          </p>
        </div>

        <StatsDashboard />

        <RoleGate roles={['SAI_ADMIN']}>
          <AdminPanel />
        </RoleGate>
      </div>
    </Layout>
  );
}
