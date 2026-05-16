import AgentRoom from "@/components/AgentRoom";

export default async function AgentRoomPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  return <AgentRoom name={name} />;
}
