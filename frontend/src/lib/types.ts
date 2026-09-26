export interface Source {
  id: string;
  document_id: string;
  filename: string;
  page?: number;
  section?: string;
  text: string;
}
export interface ResearchDocument {
  id: string;
  filename: string;
  size: number;
  status: "ready" | "processing" | "failed";
  graph_status: "ready" | "empty" | "pending" | "failed";
  chunks_added: number;
  graph_entities: number;
  graph_relations: number;
  created_at: string;
  error?: string;
  graph_error?: string;
  sample?: boolean;
}
export interface GraphNode {
  id: string;
  name: string;
  type: string;
  sources?: Source[];
  x?: number;
  y?: number;
}
export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
}
export interface GraphData { nodes: GraphNode[]; links: GraphLink[]; }
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  request_id?: string;
  error?: boolean;
  retryQuestion?: string;
  feedback?: number;
}
export const nodeId = (value: string | GraphNode) => typeof value === "string" ? value : value.id;
