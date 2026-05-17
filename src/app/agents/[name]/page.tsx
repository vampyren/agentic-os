import AgentWorkspace from "@/components/AgentWorkspace";

export default async function AgentRoomPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  return <AgentWorkspace name={name} />;
}
