'use client';
import { useMemo } from 'react';
import ViewerShell from '@/components/viewer/ViewerShell';
import { buildSampleBundle, sampleCatalogue, sampleComplianceCheck } from '@/lib/viewer/sampleBundle';
import { mockProvider } from '@/lib/viewer/catalogue';

export default function ViewerDemoPage() {
  const bundle = useMemo(() => buildSampleBundle(), []);
  const provider = useMemo(() => mockProvider(sampleCatalogue(), bundle.items), [bundle]);
  return <ViewerShell bundle={bundle} provider={provider} projectId="demo" complianceCheck={sampleComplianceCheck} onItemsChange={(i) => console.debug('items', i.length)} />;
}
