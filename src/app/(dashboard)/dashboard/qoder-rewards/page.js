import QoderRewardsPanel from "./QoderRewardsPanel";

// 需要运行时读取账号池 / 调用上游，禁用静态预渲染
export const dynamic = "force-dynamic";

export default function QoderRewardsPage() {
  return <QoderRewardsPanel />;
}