'use client';
import { useMemo } from 'react';
import ViewerShell from '@/components/viewer/ViewerShell';
import { buildSampleBundle, sampleCatalogue, sampleComplianceCheck } from '@/lib/viewer/sampleBundle';
import { mockProvider } from '@/lib/viewer/catalogue';
import { demoAssistant } from '@/lib/assistant';

export default function ViewerDemoPage() {
  const bundle = useMemo(() => buildSampleBundle(), []);
  const provider = useMemo(() => mockProvider(sampleCatalogue(), bundle.items), [bundle]);
  const assistant = useMemo(() => demoAssistant(bundle.parts, [bundle.info.origin[0], bundle.info.origin[1]]), [bundle]);
  return <ViewerShell demo bundle={bundle} assistant={assistant} provider={provider} projectId="demo" complianceCheck={sampleComplianceCheck} onItemsChange={(i) => console.debug('items', i.length)} />;
}
