export interface AgentState {
  status: string;
  iteration: number;
  values: Record<string, unknown>;
}
