import type {Node as GraphNode, Link as GraphLink, Hull as Hull, GraphData} from "./types.ts";
import type {GraphLayoutEngine} from "./GraphLayout.ts";

// Interface for the filtered data
export interface VisibleGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  combinedHulls: Hull[];
  individualHulls: Hull[];
  nodesWithEvents: GraphNode[];
  raisedBy: Record<string, string[]>;
  receivedBy: Record<string, string[]>;
}

/** Manage all application state and data filtering logic. */
export class GraphState {
  public visible: VisibleGraph = {
    nodes: [],
    links: [],
    combinedHulls: [],
    individualHulls: [],
    nodesWithEvents: [],
    raisedBy: {},
    receivedBy: {},
  };
  // State Properties
  private fullGraphData: GraphData = {nodes: [], links: []};
  private selectedHull: Hull | null = null;

  constructor() {
  }

  // Mutate State
  public setFullData(data: GraphData): void {
    this.fullGraphData = data;
  }

  public getFullData(): GraphData {
    return this.fullGraphData;
  }

  public setSelectedHull(hull: Hull | null): void {
    this.selectedHull = hull;
  }

  public getSelectedHull(): Hull | null {
    return this.selectedHull;
  }

  /** Take the user selection, filter the full data, and store the result in its property. */
  public updateVisibleData(
    checkedInstanceIds: Set<string>,
    layoutEngine: GraphLayoutEngine
  ): void {
    // Filter nodes and links based on checkboxes
    const {nodes, links} = this.filterVisibleData(checkedInstanceIds);

    // Calculate hull data
    const {combinedHulls, individualHulls} = this.calculateHullData(nodes, links, layoutEngine);

    // Calculate event data
    const {nodesWithEvents, raisedBy, receivedBy} = this.calculateEventData(nodes, links);

    // Store all results
    this.visible = {
      nodes,
      links,
      combinedHulls,
      individualHulls,
      nodesWithEvents,
      raisedBy,
      receivedBy,
    };
  }

  /** Get the visible nodes and links based on checkbox selection. */
  private filterVisibleData(checkedInstanceIds: Set<string>): { nodes: GraphNode[], links: GraphLink[] } {
    let filteredNodes = this.fullGraphData.nodes.filter(n => {
      if (n.group === "instance") {
        return checkedInstanceIds.has(n.id);
      }
      return n.group !== "service";
    });

    // Build adjacency map for BFS
    const fullNodeMap = new Map(filteredNodes.map(n => [n.id, n]));
    const adj = new Map<string, string[]>();
    filteredNodes.forEach(n => adj.set(n.id, []));

    this.fullGraphData.links.forEach(link => {
      const sourceId = typeof link.source === "object" ? link.source.id : link.source;
      const targetId = typeof link.target === "object" ? link.target.id : link.target;
      if (fullNodeMap.has(sourceId) && fullNodeMap.has(targetId)) {
        adj.get(sourceId)!.push(targetId);
        adj.get(targetId)!.push(sourceId);
      }
    });

    // BFS from checked instance nodes
    const visited = new Set<string>();
    const queue = [...filteredNodes.filter(n => n.group === "instance").map(n => n.id)];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (!visited.has(id)) {
        visited.add(id);
        const neighbors = adj.get(id) || [];
        neighbors.forEach(nid => {
          if (!visited.has(nid)) queue.push(nid);
        });
      }
    }

    // Clone the visible nodes and links
    const originalNodes = new Map(this.fullGraphData.nodes.map(n => [n.id, n]));
    let nodes = Array.from(visited).map(id => {
      const originalNode = originalNodes.get(id)!;
      return {...originalNode}; // Clone
    });

    const nodeMap = new Map(nodes.map(d => [d.id, d]));
    let links = this.fullGraphData.links.filter(l => {
      const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
      const targetId = typeof l.target === 'object' ? l.target.id : l.target;
      return visited.has(sourceId as string) && visited.has(targetId as string);
    })
      .map(l => ({...l}))
      .filter(l => {
        if (typeof l.source === "string") l.source = nodeMap.get(l.source) || (l.source as string);
        if (typeof l.target === "string") l.target = nodeMap.get(l.target) || (l.target as string);
        return typeof l.source === "object" && typeof l.target === "object";
      }) as GraphLink[];

    return {nodes, links};
  }

  /** Calculate hull data based on visible nodes/links. */
  private calculateHullData(
    nodes: GraphNode[],
    links: GraphLink[],
    layoutEngine: GraphLayoutEngine
  ): { combinedHulls: Hull[], individualHulls: Hull[] } {
    const combinedHulls: Hull[] = layoutEngine.findConnectedComponents(nodes, links, false)
      .map(component => {
        const key = component.map(n => n.id).sort().join("-");
        return {
          id: `hull-${key}`,
          nodes: component,
          hullType: "combined" as const
        };
      })
      .filter(c => c.nodes.find(n => n.group === "instance") !== undefined);

    const individualHulls = layoutEngine.findConnectedComponents(nodes, links, true)
      .map(component => {
        const key = component.map(n => n.id).sort().join("-");
        return {
          id: `hull-${key}`,
          nodes: component,
          hullType: "individual" as const
        };
      })
      .filter(c => c.nodes.find(n => n.group === "instance") !== undefined)
      .filter(h => {
        const key = h.id.replace('hull-ind-', '');
        return !new Set(combinedHulls.map(h => h.id.replace('hull-com-', ''))).has(key);
      });

    return {combinedHulls, individualHulls};
  }

  /** Calculates event data for info boxes. */
  private calculateEventData(nodes: GraphNode[], links: GraphLink[]): {
    nodesWithEvents: GraphNode[],
    raisedBy: Record<string, string[]>,
    receivedBy: Record<string, string[]>
  } {
    const raisedBy: Record<string, string[]> = {};
    const receivedBy: Record<string, string[]> = {};
    links.filter(l => l.type === "event-link").forEach(l => {
      const sourceId = typeof l.source === "object" ? l.source.id : l.source;
      const targetId = typeof l.target === "object" ? l.target.id : l.target;
      if (sourceId) {
        raisedBy[sourceId] = raisedBy[sourceId] || [];
        if (l.event && !raisedBy[sourceId].includes(l.event)) raisedBy[sourceId].push(l.event);
      }
      if (targetId) {
        receivedBy[targetId] = receivedBy[targetId] || [];
        if (l.event && !receivedBy[targetId].includes(l.event)) receivedBy[targetId].push(l.event);
      }
    });

    const nodesWithEvents = nodes.filter(n =>
      n.group === "instance" &&
      ((raisedBy[n.id] && raisedBy[n.id].length > 0) ||
        (receivedBy[n.id] && receivedBy[n.id].length > 0))
    );

    return {nodesWithEvents, raisedBy, receivedBy};
  }
}