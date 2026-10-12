import { ViewerShell } from "@/components/viewer/ViewerShell";
export default function ViewerPage({ params }: { params: { id: string } }) { return <ViewerShell projectId={params.id} />; }
