import * as d3 from "d3";
import type {Node as GraphNode, Link as GraphLink, GraphData} from "./types.ts";

/** Encapsulate all graph layout logic. */
export class GraphLayoutEngine {
  private readonly width: number;
  private readonly height: number;

  // Layout Parameters
  private readonly LAYOUT_PARAMS = {
    SPACING_Y: 350,
    RECT_HEIGHT: 150,
    COLUMN_WIDTH: 100,
    COLUMN_GAP: 100,
  };

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  /**
   * Calculate and assign the layout coordinates for all nodes in the graph.
   *
   * @param data The complete GraphData object containing all nodes and links.
   * @returns The parameters of the main layout ellipse.
   */
  public calculateLayout(data: GraphData): { radiusX: number; radiusY: number } {
    const nodes = data.nodes;
    const links = data.links;

    // Find connected components
    const components = this.findConnectedComponents(nodes, links, false);
    type ComponentNode = {
      nodes: GraphNode[];
      x: number;
      y: number;
      angle: number;
      radius: number;
    };

    // Compute initial elliptical positions and radius
    const componentCount = components.length;
    const radiusX = (this.width * 0.4) + componentCount * 100;
    const radiusY = (this.height * 0.4) + componentCount * 100;

    const componentNodes: ComponentNode[] = components.map((componentArray, i) => {
      const angle = (2 * Math.PI * i) / componentCount;

      // Estimate Combined Hull Radius
      const nestedComponents = this.findConnectedComponents(componentArray, links, true);
      let combinedRadius: number;

      if (nestedComponents.length <= 1) {
        combinedRadius = nestedComponents.length === 1
          ? this.getIndividualHullRadius(nestedComponents[0], links)
          : 150;
      } else {
        combinedRadius = Math.sqrt(nestedComponents.map(hullNodes => this.getIndividualHullRadius(hullNodes, links)).reduce((acc, r) => acc + (r * r), 0)) * 1.25;
      }

      return {
        nodes: componentArray,
        angle,
        x: this.width / 2 + radiusX * Math.cos(angle),
        y: this.height / 2 + radiusY * Math.sin(angle),
        radius: Math.max(combinedRadius, 200),
      };
    });

    // Layout Nodes
    const individualHullCenters = new Map<string, { x: number; y: number }>();
    const individualHullNodes = new Map<string, GraphNode[]>();

    componentNodes.forEach((componentNode) => {
      const combinedHullCenterX = componentNode.x ?? this.width / 2;
      const combinedHullCenterY = componentNode.y ?? this.height / 2;
      const nestedComponents = this.findConnectedComponents(componentNode.nodes, links, true);

      // Found one individual hull inside
      if (nestedComponents.length <= 1) {
        const hullArray = nestedComponents[0] || componentNode.nodes;
        const instanceNode = hullArray.find(n => n.group === 'instance');
        if (instanceNode) {
          individualHullCenters.set(instanceNode.id, {x: combinedHullCenterX, y: combinedHullCenterY});
          individualHullNodes.set(instanceNode.id, hullArray);
        }
      }
      // Found multiple individual hulls inside
      else {
        type NestedSimNode = {
          id: string;
          nodes: GraphNode[];
          x: number;
          y: number;
          radius: number;
        };

        const nestedMetaNodes: NestedSimNode[] = nestedComponents.map((individualHullArray, j) => {
          const componentRadius = this.getIndividualHullRadius(individualHullArray, links)
          const nodeId = individualHullArray.find(n => n.group === 'instance')?.id || `nested-${Math.random()}`;
          individualHullNodes.set(nodeId, individualHullArray);

          return {
            id: nodeId,
            nodes: individualHullArray,
            x: combinedHullCenterX + 5 * Math.cos((2 * Math.PI * j) / nestedComponents.length),
            y: combinedHullCenterY + 5 * Math.sin((2 * Math.PI * j) / nestedComponents.length),
            radius: componentRadius,
          };
        });

        // Run a simulation for individual hulls inside combined hull
        const nestedSim = d3.forceSimulation<NestedSimNode>(nestedMetaNodes)
          .force("collide", d3.forceCollide<NestedSimNode>(d => d.radius * 0.7).strength(0.3))
          .force("center", d3.forceCenter(combinedHullCenterX, combinedHullCenterY).strength(0.5))
          .stop()
          .tick(300);

        nestedMetaNodes.forEach(meta => {
          individualHullCenters.set(meta.id, {x: meta.x ?? combinedHullCenterX, y: meta.y ?? combinedHullCenterY});
        });
      }
    });
    // Apply layout to each individual hull
    individualHullNodes.forEach((individualHullArray, instanceId) => {
      const compCenterX = individualHullCenters.get(instanceId)?.x ?? this.width / 2;
      const compCenterY = individualHullCenters.get(instanceId)?.y ?? this.height / 2;

      const instanceNode = individualHullArray.find(n => n.group === "instance");
      if (!instanceNode) return;

      const initialNode = individualHullArray.find(n =>
        n.group !== "instance" &&
        links.some(l => (l.source as GraphNode).id === instanceNode.id && (l.target as GraphNode).id === n.id)
      );

      const terminalNodes = individualHullArray.filter(n => n.isTerminal);
      const intermediateNodes = individualHullArray.filter(n => n !== instanceNode && n !== initialNode && !n.isTerminal && n.group !== "service");

      const gridCols = intermediateNodes.length > 0 ? Math.ceil(Math.sqrt(intermediateNodes.length)) : 0;
      const gridWidth = gridCols > 0 ? (gridCols - 1) * (this.LAYOUT_PARAMS.COLUMN_WIDTH + this.LAYOUT_PARAMS.COLUMN_GAP) + this.LAYOUT_PARAMS.COLUMN_WIDTH : 0;

      let totalComponentWidth = this.LAYOUT_PARAMS.COLUMN_WIDTH;
      if (initialNode) totalComponentWidth += this.LAYOUT_PARAMS.COLUMN_GAP + this.LAYOUT_PARAMS.COLUMN_WIDTH;
      if (gridWidth > 0) totalComponentWidth += this.LAYOUT_PARAMS.COLUMN_GAP + gridWidth;
      if (terminalNodes.length > 0) totalComponentWidth += this.LAYOUT_PARAMS.COLUMN_GAP + this.LAYOUT_PARAMS.COLUMN_WIDTH;

      let currentX = compCenterX - totalComponentWidth / 2;
      const instanceX = currentX + this.LAYOUT_PARAMS.COLUMN_WIDTH / 2;

      currentX += this.LAYOUT_PARAMS.COLUMN_WIDTH + this.LAYOUT_PARAMS.COLUMN_GAP;
      const initialX = initialNode ? currentX + this.LAYOUT_PARAMS.COLUMN_WIDTH / 2 : 0;

      if (initialNode) currentX += this.LAYOUT_PARAMS.COLUMN_WIDTH + this.LAYOUT_PARAMS.COLUMN_GAP;
      const gridStartX = gridWidth > 0 ? currentX : 0;

      currentX += gridWidth + this.LAYOUT_PARAMS.COLUMN_GAP;
      const terminalX = terminalNodes.length > 0 ? currentX + this.LAYOUT_PARAMS.COLUMN_WIDTH / 2 : 0;

      const distribute = (nodesToDistribute: GraphNode[], xPos: number) => {
        const count = nodesToDistribute.length;
        if (count === 0) return;
        nodesToDistribute.forEach((node, j) => {
          node.x = xPos;
          node.y = count === 1 ? compCenterY : compCenterY - this.LAYOUT_PARAMS.RECT_HEIGHT / 2 + j * (this.LAYOUT_PARAMS.RECT_HEIGHT / Math.max(1, count - 1));
        });
      };

      const distributeInGrid = (nodesToDistribute: GraphNode[], startX: number, w: number) => {
        const count = nodesToDistribute.length;
        if (count === 0) return;
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        nodesToDistribute.forEach((node, idx) => {
          const colIndex = idx % cols;
          const rowIndex = Math.floor(idx / cols);
          node.x = cols === 1 ? startX + w / 2 : startX + (colIndex * (w / (cols - 1)));
          node.y = rows === 1 ? compCenterY : compCenterY - this.LAYOUT_PARAMS.RECT_HEIGHT / 2 + rowIndex * (this.LAYOUT_PARAMS.RECT_HEIGHT / (rows - 1));
        });
      };

      // Apply the layout for this individual hulls nodes
      distribute([instanceNode], instanceX);
      if (initialNode) distribute([initialNode], initialX);
      distributeInGrid(intermediateNodes, gridStartX, gridWidth);
      distribute(terminalNodes, terminalX);
    });

    return {radiusX, radiusY};
  }

  /**
   * Calculate the positions for filtered visible components and arrange them on an ellipse
   *
   * @param nodes The visible nodes.
   * @param links The visible links.
   * @param width The SVG width.
   * @param height The SVG height.
   * @returns The radii of the new ellipse.
   */
  public positionVisibleComponents(
    nodes: GraphNode[],
    links: GraphLink[],
    width: number,
    height: number
  ): { radiusX: number, radiusY: number } {
    const visibleComponents = this.findConnectedComponents(nodes, links, false);
    const componentCount = visibleComponents.length;
    const radiusX = (width * 0.4) + componentCount * 100;
    const radiusY = (height * 0.4) + componentCount * 100;

    // Move components to new positions
    visibleComponents.forEach((componentNodes, i: number) => {
      const dx = (width / 2 + radiusX * Math.cos((2 * Math.PI * i) / componentCount)) - (Math.min(...componentNodes.map(n => n.x!)) + Math.max(...componentNodes.map(n => n.x!))) / 2;
      const dy = (height / 2 + radiusY * Math.sin((2 * Math.PI * i) / componentCount)) - (Math.min(...componentNodes.map(n => n.y!)) + Math.max(...componentNodes.map(n => n.y!))) / 2;

      componentNodes.forEach(node => {
        node.x = node.x! + dx;
        node.y = node.y! + dy;
      });
    });

    return {radiusX, radiusY};
  }

  /**
   * Calculate and assign layout coordinates for service nodes around a hull.
   *
   * @param hullNodes The nodes of the hull to circle.
   * @param servicesToLayout The service nodes to position
   * @returns The x coordinate of the center of the hull
   */
  public layoutServiceNodes(
    hullNodes: GraphNode[],
    servicesToLayout: GraphNode[]
  ): { cx: number } {
    const nonServiceNodes = hullNodes.filter(n => n.group !== "service");
    const minX = d3.min(nonServiceNodes, n => n.x ?? 0) ?? 0;
    const maxX = d3.max(nonServiceNodes, n => n.x ?? 0) ?? 0;
    const minY = d3.min(nonServiceNodes, n => n.y ?? 0) ?? 0;
    const maxY = d3.max(nonServiceNodes, n => n.y ?? 0) ?? 0;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const hullRadiusX = Math.max(maxX - minX, 100) / 2 + 150;
    const hullRadiusY = Math.max(maxY - minY, 100) / 2 + 150;

    const angleStep = (2 * Math.PI) / (servicesToLayout.length || 1);
    servicesToLayout.forEach((node, i) => {
      node.x = cx + hullRadiusX * Math.cos(i * angleStep);
      node.y = cy + hullRadiusY * Math.sin(i * angleStep);
    });

    return {cx};
  }

  /**
   * Find connected components in the graph
   *
   * @param nodes Nodes in the graph
   * @param links Links connecting those nodes
   * @param nested Flag whether to ignore nested relation (find hulls for each state machine) or not (treat parent and child state machine as one for hull creation)
   * @private
   */
  public findConnectedComponents(nodes: GraphNode[], links: GraphLink[], nested: boolean): GraphNode[][] {
    const filteredLinks = links.filter((link) => link.type !== "event-link");
    const components: GraphNode[][] = [];
    const visited = new Set<string>();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const adj = new Map<string, string[]>();
    nodes.forEach((n) => adj.set(n.id, []));

    filteredLinks.forEach((link) => {
      if (link.type === "nested" && nested) return;
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;
      if (adj.has(sourceId) && adj.has(targetId)) {
        adj.get(sourceId)!.push(targetId);
        adj.get(targetId)!.push(sourceId);
      }
    });

    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      const component: GraphNode[] = [];
      const queue: GraphNode[] = [node];
      visited.add(node.id);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        component.push(cur);
        const neighbors = adj.get(cur.id) || [];
        for (const nid of neighbors) {
          if (!visited.has(nid)) {
            visited.add(nid);
            const neighborNode = nodeMap.get(nid);
            if (neighborNode) queue.push(neighborNode);
          }
        }
      }
      components.push(component);
    }
    return components;
  }

  /**
   * Estimate the layout radius of an individual state machine hull.
   *
   * @param individualHullArray The array of GraphNode objects that belong to this specific hull
   * @param allLinks Complete list of links in the graph
   */
  private getIndividualHullRadius(individualHullArray: GraphNode[], allLinks: GraphLink[]): number {
    const instanceNode = individualHullArray.find(n => n.group === "instance");

    // Find nodes connected to this instance
    const initialNode = individualHullArray.find(n =>
      n.group !== "instance" &&
      allLinks.some(l => (l.source as GraphNode).id === instanceNode?.id && (l.target as GraphNode).id === n.id)
    );
    const terminalNodes = individualHullArray.filter(n => n.isTerminal);
    const intermediateNodes = individualHullArray.filter(n =>
      n !== instanceNode &&
      n !== initialNode &&
      !n.isTerminal &&
      n.group !== "service"
    );

    const gridCols = intermediateNodes.length > 0 ? Math.ceil(Math.sqrt(intermediateNodes.length)) : 0;
    const gridWidth = gridCols > 0
      ? (gridCols - 1) * (this.LAYOUT_PARAMS.COLUMN_WIDTH + this.LAYOUT_PARAMS.COLUMN_GAP) + this.LAYOUT_PARAMS.COLUMN_WIDTH
      : 0;

    let totalComponentWidth = this.LAYOUT_PARAMS.COLUMN_WIDTH;
    if (initialNode) totalComponentWidth += this.LAYOUT_PARAMS.COLUMN_GAP + this.LAYOUT_PARAMS.COLUMN_WIDTH;
    if (gridWidth > 0) totalComponentWidth += this.LAYOUT_PARAMS.COLUMN_GAP + gridWidth;
    if (terminalNodes.length > 0) totalComponentWidth += this.LAYOUT_PARAMS.COLUMN_GAP + this.LAYOUT_PARAMS.COLUMN_WIDTH;

    const totalComponentHeight = this.LAYOUT_PARAMS.RECT_HEIGHT;

    // Estimate radius as half the max dimension plus padding
    return Math.max(totalComponentWidth, totalComponentHeight) / 2 + 30;
  }
}