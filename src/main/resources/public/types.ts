/** Define the structure for a single node in the D3 graph. */
export interface Node {
  id: string;
  label: string;
  group: 'instance' | 'state' | 'service';
  smId: string | null;
  isActive?: boolean;
  isTerminal?: boolean;
  isInitial?: boolean;
  context?: Record<string, string>;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

/**
 * Define a link between two nodes.
 * The source and target can be string IDs
 * or full Node objects (after D3 processes them).
 */
export interface Link {
  source: string | Node;
  target: string | Node;
  type: 'contains' | 'transition' | 'invokes' | 'nested' | 'event-link';
  event?: string;
}

/** Represent the entire graph data structure for a full state update. */
export interface GraphData {
  nodes: Node[];
  links: Link[];
}

export interface Hull {
  id: string;
  nodes: Node[];
  hullType: "individual" | "combined";
}

/** Defines all possible message types that can be received over the WebSocket. */
export type WebSocketMessage =
  | { type: 'statusUpdate'; payload: GraphData }
  | { type: 'invocation'; payload: { sourceId: string, targetId: string } }