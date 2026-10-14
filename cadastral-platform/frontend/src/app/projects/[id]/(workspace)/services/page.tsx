"use client";
import { api } from "@/lib/api";
import { useRemote } from "@/lib/useRemote";
import { Results } from "@/components/Results";
import { SampleBanner } from "@/components/ui/Status";
export default function Services({ params }: { params: { id: string } }) {
  const { data, sample, error, loading } = useRemote(() => api.resultsSampled(params.id), [params.id]);
  return (<div>
    {sample && <SampleBanner what="Services and driveway" />}
    <p className="h-eyebrow">Services and driveway</p><h2 className="mt-2 font-display text-3xl font-medium">Crossover, services and water</h2>
    {error && <p role="alert" className="mt-4 text-danger">{error}</p>}
    <div className="mt-6">{loading && !data ? <p className="text-muted">Loading...</p> : data && <Results r={data} />}</div>
  </div>);
}
