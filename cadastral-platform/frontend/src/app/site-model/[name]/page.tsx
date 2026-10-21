'use client';
import { use, useEffect, useMemo, useState } from 'react';
import ViewerShell from '@/components/viewer/ViewerShell';
import { fetchBundle } from '@/lib/viewer/loadBundle';
import { mockProvider } from '@/lib/viewer/catalogue';
import { sampleCatalogue } from '@/lib/viewer/sampleBundle';
import type { SceneBundle } from '@/lib/viewer/types';

// Opens a generated scene bundle (public/samples/bundles/<name>.json) in the viewer.
export default function SiteModel({ params }: { params: Promise<{ name: string }> | { name: string } }) {
  const { name } = 'then' in params ? use(params) : params;
  const [bundle, setBundle] = useState<SceneBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchBundle(`/samples/bundles/${name}.json`).then(setBundle).catch((e) => setErr(String(e.message || e))); }, [name]);
  const provider = useMemo(() => mockProvider(sampleCatalogue(), []), []);
  if (err) return <div className="v3d" role="alert"><p style={{ padding: 24 }}>Could not load model “{name}”: {err}</p></div>;
  if (!bundle) return <div className="v3d" aria-busy="true"><p style={{ padding: 24 }}>Loading model…</p></div>;
  return <ViewerShell bundle={bundle} provider={provider} projectId={name} />;
}
