import { Layout } from '@/components/Layout';
import { StatsDashboard } from '@/components/StatsDashboard';

export function Stats() {
  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Statistics</h1>
          <p className="mt-2 text-gray-600">
            Detailed execution statistics and performance metrics
          </p>
        </div>

        <StatsDashboard />
      </div>
    </Layout>
  );
}
