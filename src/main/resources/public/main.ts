import * as d3 from "d3";
import type { Node as GraphNode, Link as GraphLink, Hull as Hull, GraphData, WebSocketMessage } from "./types.ts";
import {select} from "d3";

/* ----------------------------- DOM & Config ----------------------------- */

const container = document.getElementById("graph-container");
if (!container) throw new Error("Element with id 'graph-container' not found.");

const width = container.clientWidth;
const height = container.clientHeight;

const flashingNodes = new Set<string>();

let selectedHull: Hull | null = null;

// D3 Selections with generics
const svg = d3
    .select<HTMLElement, unknown>(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

const g = svg.append<SVGGElement>("g");
const tooltip = d3.select<HTMLDivElement, unknown>("#tooltip");

svg.call(
    d3
        .zoom<SVGSVGElement, unknown>()
        .on("zoom", (event: { transform: any; }) => {
          g.attr("transform", String(event.transform));
        })
);

/* ------------------------------- Definitions ----------------------------- */

svg
    .append("defs")
    .append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 25)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#999");

/* ------------------------------- Groups --------------------------------- */

const linkGroup = g.append<SVGGElement>("g").attr("class", "links");
const nodeGroup = g.append<SVGGElement>("g").attr("class", "nodes");
const hullGroup = g.insert<SVGGElement>("g", ".links").attr("class", "hulls");

/* ------------------------------- Legend --------------------------------- */

const color = d3.scaleOrdinal<string, string>(d3.schemeDark2);

const legend = svg
    .append<SVGGElement>("g")
    .attr("class", "legend")
    .attr("transform", `translate(${width - 250}, 20)`);

type LegendItem =
    | { type: "title"; text: string }
    | { type: "node"; group: GraphNode["group"]; text: string }
    | { type: "style"; fill: string; stroke?: string; text: string }
    | { type: "link"; linkType: GraphLink["type"]; text: string }
    | { type: "eventBox"; text: string; color: string }
    | { type: "spacer" };

const legendData: LegendItem[] = [
  { type: "title", text: "Node Types" },
  { type: "node", group: "instance", text: "State Machine Instance" },
  { type: "node", group: "state", text: "State" },
  { type: "node", group: "service", text: "Service" },
  { type: "spacer" },
  { type: "title", text: "Node Styles" },
  { type: "style", fill: "#8c564b", text: "Terminal State" },
  { type: "style", fill: "#ff7f0e", stroke: "green", text: "Active State" },
  { type: "style", fill: "#FFD700", text: "Invoked Service (Flash)" },
  { type: "spacer" },
  { type: "title", text: "Link Types" },
  { type: "link", linkType: "transition", text: "Transition" },
  { type: "link", linkType: "invokes", text: "Invokes Service" },
  { type: "link", linkType: "contains", text: "Contains" },
  { type: "spacer" },
  { type: "title", text: "Events" },
  { type: "eventBox", text: "Raises Event", color: "steelblue" },
  { type: "eventBox", text: "Receives Event", color: "crimson" },
];

const legendItem = legend
    .selectAll<SVGGElement, LegendItem>(".legend-item")
    .data(legendData)
    .join("g")
    .attr("class", "legend-item")
    .attr("transform", (_d, i) => `translate(0, ${i * 22})`);

legendItem
    .filter((d) => d.type === "title")
    .append("text")
    .attr("class", "legend-title")
    .attr("y", 8)
    .text((d) => (d as any).text);

legendItem
    .filter((d) => d.type === "node")
    .append("circle")
    .attr("r", 8)
    .attr("cy", 4)
    .style("fill", (d) => color((d as any).group));

legendItem
    .filter((d) => d.type === "style")
    .append("circle")
    .attr("r", 8)
    .attr("cy", 4)
    .style("fill", (d) => (d as any).fill)
    .style("stroke", (d) => (d as any).stroke || "none")
    .style("stroke-width", (d) => ((d as any).stroke ? 2 : 0));

legendItem
    .filter((d) => d.type === "link")
    .append("line")
    .attr("x1", 0)
    .attr("x2", 15)
    .attr("y1", 4)
    .attr("y2", 4)
    .style("stroke", (d) => ((d as any).linkType === "contains" ? "#ddd" : "#999"))
    .style("stroke-width", 2)
    .style("stroke-dasharray", (d) => ((d as any).linkType === "invokes" ? "3,3" : null))
    .attr("marker-end", (d) => ((d as any).linkType === "transition" ? "url(#arrowhead)" : null));

legendItem
    .filter((d) => !["title", "spacer", "eventBox"].includes(d.type))
    .append("text")
    .attr("x", 25)
    .attr("y", 9)
    .text((d) => (d as any).text);

legendItem.filter((d) => d.type === "eventBox").each(function (d) {
  const g = d3.select(this);
  const padding = 6;
  const lineHeight = 15;

  const text = g
      .append("text")
      .text((d as any).text)
      .attr("x", padding)
      .attr("y", lineHeight)
      .attr("font-size", 12)
      .attr("fill", (d as any).color);

  const node = text.node();
  if (!node) return;
  const bbox = node.getBBox();

  g.insert("rect", "text")
      .attr("x", bbox.x - padding / 2)
      .attr("y", bbox.y - padding / 2)
      .attr("width", bbox.width + padding)
      .attr("height", bbox.height + padding)
      .attr("rx", 4)
      .attr("ry", 4)
      .attr("fill", "rgba(255,255,255,0.9)")
      .attr("stroke", "#999")
      .attr("stroke-width", 1);
});

/* ------------------------------ Graph State ------------------------------ */

let currentData: GraphData = { nodes: [], links: [] };

/* --------------------------- Utility / Helpers --------------------------- */

/**
 * Get stable key for a link.
 */
function getLinkKey(d: GraphLink): string {
  const getId = (v?: string | GraphNode | null) => {
    if (!v) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object" && "id" in v) return v.id;
    return "";
  };

  if ((d as any).type === "event-link") {
    const src = (d as any).sourceSM || "";
    const tgt = (d as any).targetSM || "";
    const ev = (d as any).event || "";
    return `${src}-${tgt}-${ev}`;
  }

  const sourceId = getId(d.source);
  const targetId = getId(d.target);
  return `${sourceId}-${targetId}`;
}

/**
 * Find connected components.
 * @param nested whether to ignore nested links (treat nested as disconnected when nested === true)
 */
function findConnectedComponents(nodes: GraphNode[], links: GraphLink[], nested: boolean): GraphNode[][] {
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

/* ------------------------------ Positioning ----------------------------- */

function positionGraph(): void {
  // Individual hulls
    const individualHulls: Hull[] = findConnectedComponents(currentData.nodes, currentData.links, true)
        .map(component => {
            const key = component.map(n => n.id).sort().join("-");
            return {
                id: `hull-${key}`,
                nodes: component,
                hullType: "individual"
            };
        });


    hullGroup.selectAll<SVGRectElement, Hull>(".hull-individual")
        .data(individualHulls)
        .join("rect")
        .attr("class", "hull-individual hull")
        .attr("x", d => d3.min(d.nodes, n => n.x! - (n.group === "instance" ? 20 : 15) - 20) ?? 0)
        .attr("y", d => d3.min(d.nodes, n => n.y! - (n.group === "instance" ? 20 : 15) - 20) ?? 0)
        .attr("width", d => {
            const minX = d3.min(d.nodes, n => n.x! - (n.group === "instance" ? 20 : 15) - 20) ?? 0;
            const maxX = d3.max(d.nodes, n => n.x! + (n.group === "instance" ? 20 : 15) + 20) ?? 0;
            return maxX - minX;
        })
        .attr("height", d => {
            const minY = d3.min(d.nodes, n => n.y! - (n.group === "instance" ? 20 : 15) - 20) ?? 0;
            const maxY = d3.max(d.nodes, n => n.y! + (n.group === "instance" ? 20 : 15) + 20) ?? 0;
            return maxY - minY;
        })
        .style("fill-opacity", 0.15)
        .style("stroke", d => {
            const instanceNode = d.nodes.find(n => n.group === "instance");
            return instanceNode ? color(instanceNode.group) : "#aaa";
        });

// Combined hulls
    const combinedHulls: Hull[] = findConnectedComponents(currentData.nodes, currentData.links, false)
        .map(component => {
            const key = component.map(n => n.id).sort().join("-");
            return {
                id: `hull-${key}`,
                nodes: component,
                hullType: "combined"
            };
        });


    hullGroup.selectAll<SVGRectElement, Hull>(".hull-combined")
        .data(combinedHulls)
        .join("rect")
        .attr("class", "hull-combined hull")
        .attr("x", d => d3.min(d.nodes, n => n.x! - (n.group === "instance" ? 20 : 15) - 20) ?? 0)
        .attr("y", d => d3.min(d.nodes, n => n.y! - (n.group === "instance" ? 20 : 15) - 20) ?? 0)
        .attr("width", d => {
            const minX = d3.min(d.nodes, n => n.x! - (n.group === "instance" ? 20 : 15) - 20) ?? 0;
            const maxX = d3.max(d.nodes, n => n.x! + (n.group === "instance" ? 20 : 15) + 20) ?? 0;
            return maxX - minX;
        })
        .attr("height", d => {
            const minY = d3.min(d.nodes, n => n.y! - (n.group === "instance" ? 20 : 15) - 20) ?? 0;
            const maxY = d3.max(d.nodes, n => n.y! + (n.group === "instance" ? 20 : 15) + 20) ?? 0;
            return maxY - minY;
        })
        .style("fill-opacity", 0.05)
        .style("stroke-dasharray", "10,10")
        .style("stroke", d => {
            const instanceNode = d.nodes.find(n => n.group === "instance");
            return instanceNode ? color(instanceNode.group) : "#aaa";
        });


    // Links positions
  linkGroup.selectAll("line").attr("x1", (d: any) => d.source.x).attr("y1", (d: any) => d.source.y).attr("x2", (d: any) => d.target.x).attr("y2", (d: any) => d.target.y);

  // Nodes positions
  nodeGroup.selectAll("g").attr("transform", (d: any) => `translate(${d.x},${d.y})`);
}

/* ------------------------------- UpdateGraph ---------------------------- */

function setupHullInteractions(nodes: GraphNode[]): void {
    hullGroup.selectAll<SVGRectElement, Hull>("rect.hull")
        .style("cursor", "pointer")
        .on("click", function (event, clickedHull) {

            event.stopPropagation();

            if (clickedHull.id === selectedHull?.id) {
                // Clicked the same hull again: reset
                selectedHull = null;
                resetGraphView();
            } else {
                // Clicked a new hull: apply selection
                selectedHull = clickedHull;
                applyGraphView(selectedHull,300, nodes);
            }
        });
}


/**
 * setupNodes: binds nodes and establishes tooltip interactions.
 * Returns the selection of node groups.
 */
function setupNodes(nodes: GraphNode[]) {
  const sel = nodeGroup
      .selectAll<SVGGElement, GraphNode>("g.node")
      .data(nodes.filter((n) => n.group !== "service"), (d) => (d as GraphNode).id)
      .join(
          (enter) => {
            const group = enter.append<SVGGElement>("g").attr("class", "node");
            group.append("circle").attr("r", (d) => (d.group === "instance" ? 20 : 15));
            group.append("text").text((d) => d.label).attr("x", 22).attr("y", 5);
            return group;
          },
          (update) => update,
          (exit) => exit.remove()
      ) as d3.Selection<SVGGElement, GraphNode, SVGGElement, GraphNode>;

  sel.on("mouseover", (event: MouseEvent, d: GraphNode) => {
    tooltip
        .transition()
        .duration(200)
        .style("opacity", 0.9);

    let tooltipText = `ID: ${d.label}\nGroup: ${d.group}`;
    if (d.context) {
      tooltipText += `\n\nContext:\n${JSON.stringify(d.context, null, 2)}`;
    }

    tooltip
        .html(tooltipText.replace(/\n/g, "<br/>"))
        .style("left", event.pageX + 15 + "px")
        .style("top", event.pageY - 28 + "px");
  }).on("mouseout", () => {
    tooltip.transition().duration(500).style("opacity", 0);
  });

  return sel;
}

/**
 * applyNodeStyles: visually update nodes (fill/stroke) with transitions.
 */
function applyNodeStyles(): void {
    nodeGroup
        .selectAll<SVGGElement, GraphNode>("g.node")
        .select<SVGCircleElement>("circle")
        .transition()
        .duration(150)
        .style("fill", d => {
            if (flashingNodes.has(d.id)) return "#FFD700";
            if (d.isTerminal) return "#731B0D";
            return color(d.group);
        })
        .style("stroke", d => (d.isActive ? "darkgreen" : (d.group === "service") ? "#555":"#fff"))
        .style("stroke-width", d => (d.isActive ? 4 : 2));
}


/**
 * flashServiceNode: temporarily mark a node as flashing (gold).
 */
function flashServiceNode(payload: { targetId: string }): void {
  const { targetId } = payload;
  flashingNodes.add(targetId);
  applyNodeStyles();
  window.setTimeout(() => {
    flashingNodes.delete(targetId);
    applyNodeStyles();
  }, 1000);
}

/* -------------------------------- updateGraph --------------------------- */

function updateGraph(newData: GraphData): void {
  // Normalize links to object references where possible
  const nodeMap = new Map(newData.nodes.map((d) => [d.id, d]));
  newData.links.forEach((link) => {
    if (typeof link.source === "string") link.source = nodeMap.get(link.source) || (link.source as string);
    if (typeof link.target === "string") link.target = nodeMap.get(link.target) || (link.target as string);
  });

  const oldNodeMap = new Map(currentData.nodes.map((d) => [d.id, d]));

  // --- Layout parameters ---
  const LAYOUT_PARAMS = {
    SPACING_Y: 350,
    RECT_HEIGHT: 150,
    COLUMN_WIDTH: 100,
    COLUMN_GAP: 100,
  };

  const components = findConnectedComponents(newData.nodes, newData.links, true);
  const componentCount = components.length;
  const totalHeight = LAYOUT_PARAMS.SPACING_Y * Math.max(0, componentCount - 1);
  const startY = (height - totalHeight) / 2;
  const compCenterX = width / 2;

  components.forEach((component, i) => {
    const compCenterY = startY + i * LAYOUT_PARAMS.SPACING_Y;

    // find nodes by type
    const instanceNode = component.find((n) => n.group === "instance");
    if (!instanceNode) return;

    const initialNode = component.find(
        (n) =>
            n.group !== "instance" &&
            newData.links.some((l) => (l.source as GraphNode).id === instanceNode.id && (l.target as GraphNode).id === n.id)
    );

    const terminalNodes = component.filter((n) => n.isTerminal);
    const intermediateNodes = component.filter((n) => n !== instanceNode && n !== initialNode && !n.isTerminal && n.group !== "service");

    const intermediateCount = intermediateNodes.length;
    const gridCols = intermediateCount > 0 ? Math.ceil(Math.sqrt(intermediateCount)) : 0;
    const gridWidth = gridCols > 0 ? (gridCols - 1) * (LAYOUT_PARAMS.COLUMN_WIDTH + LAYOUT_PARAMS.COLUMN_GAP) + LAYOUT_PARAMS.COLUMN_WIDTH : 0;

    let totalComponentWidth = LAYOUT_PARAMS.COLUMN_WIDTH;
    if (initialNode) totalComponentWidth += LAYOUT_PARAMS.COLUMN_GAP + LAYOUT_PARAMS.COLUMN_WIDTH;
    if (gridWidth > 0) totalComponentWidth += LAYOUT_PARAMS.COLUMN_GAP + gridWidth;
    if (terminalNodes.length > 0) totalComponentWidth += LAYOUT_PARAMS.COLUMN_GAP + LAYOUT_PARAMS.COLUMN_WIDTH;

    let currentX = compCenterX - totalComponentWidth / 2;

    const instanceX = currentX + LAYOUT_PARAMS.COLUMN_WIDTH / 2;
    currentX += LAYOUT_PARAMS.COLUMN_WIDTH + LAYOUT_PARAMS.COLUMN_GAP;

    const initialX = initialNode ? currentX + LAYOUT_PARAMS.COLUMN_WIDTH / 2 : 0;
    if (initialNode) currentX += LAYOUT_PARAMS.COLUMN_WIDTH + LAYOUT_PARAMS.COLUMN_GAP;

    const gridStartX = gridWidth > 0 ? currentX : 0;
    currentX += gridWidth + LAYOUT_PARAMS.COLUMN_GAP;

    const terminalX = terminalNodes.length > 0 ? currentX + LAYOUT_PARAMS.COLUMN_WIDTH / 2 : 0;

    const distribute = (nodes: GraphNode[], xPos: number) => {
      const count = nodes.length;
      if (count === 0) return;

      nodes.forEach((node, j) => {
        const oldNode = oldNodeMap.get(node.id);
        if (oldNode) {
          Object.assign(node, { x: oldNode.x, y: oldNode.y, vx: oldNode.vx, vy: oldNode.vy });
        } else {
          node.x = xPos;
          if (count === 1) {
            node.y = compCenterY;
          } else {
            const yStep = LAYOUT_PARAMS.RECT_HEIGHT / Math.max(1, count - 3);
            node.y = compCenterY - LAYOUT_PARAMS.RECT_HEIGHT / 2 + j * yStep;
          }
        }
      });
    };

    const distributeInGrid = (nodes: GraphNode[], startX: number, w: number) => {
      const count = nodes.length;
      if (count === 0) return;

      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);

      nodes.forEach((node, idx) => {
        const oldNode = oldNodeMap.get(node.id);
        if (oldNode) {
          Object.assign(node, { x: oldNode.x, y: oldNode.y, vx: oldNode.vx, vy: oldNode.vy });
          return;
        }

        const colIndex = idx % cols;
        const rowIndex = Math.floor(idx / cols);

        node.x = cols === 1 ? startX + w / 2 : startX + (colIndex * (w / (cols - 1)));
        node.y =
            rows === 1 ? compCenterY : compCenterY - LAYOUT_PARAMS.RECT_HEIGHT / 2 + rowIndex * (LAYOUT_PARAMS.RECT_HEIGHT / (rows - 1));
      });
    };

    distribute([instanceNode], instanceX);
    if (initialNode) distribute([initialNode], initialX);
    distributeInGrid(intermediateNodes, gridStartX, gridWidth);
    distribute(terminalNodes, terminalX);
  });

  currentData = newData;
  const { nodes, links } = currentData;

  const separateComponents = findConnectedComponents(nodes, links, true).map((c) => Object.assign(c, { hullType: "individual" }));
  const combinedComponents = findConnectedComponents(nodes, links, false).map((c) => Object.assign(c, { hullType: "combined" }));

  const allHullsData = separateComponents.concat(combinedComponents);

  hullGroup
      .selectAll("path")
      .data(allHullsData as any)
      .join("path")
      .attr("class", "hull")
      .style("fill-opacity", (d: any) => (d.hullType === "combined" ? 0.05 : 0.15))
      .style("stroke-dasharray", (d: any) => (d.hullType === "combined" ? "10,10" : null))
      .style("fill", (component: any) => {
        const instanceNode = component.find((node: GraphNode) => node.group === "instance");
        return instanceNode ? color(instanceNode.group) : "#aaa";
      });

  // Build raised/received event maps
  const raisedBy: Record<string, string[]> = {};
  const receivedBy: Record<string, string[]> = {};
  links
      .filter((l) => l.type === "event-link")
      .forEach((l) => {
        const sourceId = typeof l.source === "object" ? l.source.id : (l.source as string);
        const targetId = typeof l.target === "object" ? l.target.id : (l.target as string);
        if (sourceId) {
          if (!raisedBy[sourceId]) raisedBy[sourceId] = [];
          if (l.event && !raisedBy[sourceId].includes(l.event)) raisedBy[sourceId].push(l.event);
        }
        if (targetId) {
          if (!receivedBy[targetId]) receivedBy[targetId] = [];
          if (l.event && !receivedBy[targetId].includes(l.event)) receivedBy[targetId].push(l.event);
        }
      });

  // Bind instance nodes to event-info groups
  const infoGroups = g
      .selectAll<SVGGElement, GraphNode>(".event-info")
      .data(nodes.filter((n) => n.group === "instance"), (d) => d.id)
      .join(
          (enter) => {
            const gEnter = enter.append<SVGGElement>("g").attr("class", "event-info");
            gEnter.append("rect").attr("class", "event-info-box").attr("rx", 6).attr("ry", 6).attr("stroke", "#999").attr("stroke-width", 1);
            gEnter.append("text").attr("class", "event-info-text").attr("font-size", 12);
            return gEnter;
          },
          (update) => update,
          (exit) => exit.remove()
      );

  infoGroups.each(function (d) {
    const group = d3.select(this);
    const raised = raisedBy[d.id] || [];
    const received = receivedBy[d.id] || [];
    const lines: string[] = [];
    const lineColors: string[] = [];

    if (raised.length > 0) {
      lines.push(`${raised.join(", ")}`);
      lineColors.push("steelblue");
    }
    if (received.length > 0) {
      lines.push(`${received.join(", ")}`);
      lineColors.push("crimson");
    }
    if (lines.length === 0) {
      group.selectAll(".event-info-text, .event-info-box-wrapper").remove();
      return;
    }

    const padding = 6;
    const lineHeight = 15;

    const textWrapper = group
        .selectAll<SVGGElement, null>(".event-info-box-wrapper")
        .data([null])
        .join("g")
        .attr("class", "event-info-box-wrapper");

    const texts = textWrapper
        .selectAll<SVGTextElement, string>(".event-info-text")
        .data(lines)
        .join(
            (enter) => enter.append("text").attr("class", "event-info-text"),
            (update) => update,
            (exit) => exit.remove()
        )
        .text((t) => t)
        .attr("x", padding)
        .attr("y", (_t, i) => padding + (i + 1) * lineHeight - 2)
        .attr("fill", (_t, i) => lineColors[i]);

    // Ensure rect is behind text
    group.select(".event-info-box").lower();

    const wrapperNode = textWrapper.node();
    if (!wrapperNode) return;
    const bbox = wrapperNode.getBBox();

    group
        .select(".event-info-box")
        .attr("x", bbox.x - padding / 2)
        .attr("y", bbox.y - padding / 2)
        .attr("width", bbox.width + padding)
        .attr("height", bbox.height + padding)
        .attr("fill", "rgba(255,255,255,0.9)");

    group.attr("transform", `translate(${d.x}, ${d.y! - bbox.height - 70})`);
  });

  // Setup nodes and links (non-event links)
  const nodeSelection = setupNodes(nodes);

  const link = linkGroup
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(links.filter((link) => link.type !== "event-link"), getLinkKey)
      .join("line")
      .style("stroke-width", (d) => (d.type === "nested" ? 3 : d.type === "invokes" ? 0 : 1.5))
      .style("stroke", (d) => {
        if (d.type === "nested") return "purple";
        if (d.type === "contains") return "white";
        return "#999";
      })
      .style("stroke-dasharray", (d) => (d.type === "invokes" || d.type === "nested" ? "5,5" : null))
      .attr("marker-end", (d) => (d.type === "transition" || d.type === "nested" ? "url(#arrowhead)" : null));

  applyNodeStyles();
  positionGraph();
  setupHullInteractions(nodes);

    if (selectedHull) {
        // Find the "new" hull object from the new data that corresponds
        // to the "old" selectedHull by matching the instance node ID.
        const selectedInstanceId = selectedHull.nodes.find(n => n.group === "instance")?.id;

        if (selectedInstanceId) {
            // Re-calculate the components based on the new data
            const newComponents : Hull[] = selectedHull.hullType === "individual"
                ? findConnectedComponents(currentData.nodes, currentData.links, true).map(component => {
                    const key = component.map(n => n.id).sort().join("-");
                    return {
                        id: `hull-${key}`,
                        nodes: component,
                        hullType: "combined"
                    };
                })
                : findConnectedComponents(currentData.nodes, currentData.links, false).map(component => {
                    const key = component.map(n => n.id).sort().join("-");
                    return {
                        id: `hull-${key}`,
                        nodes: component,
                        hullType: "combined"
                    };
                });

            const newSelectedComponent = newComponents.find(component =>
                component.nodes.some(node => node.id === selectedInstanceId)
            );

            if (newSelectedComponent) {
                selectedHull = newSelectedComponent;
                applyGraphView(selectedHull, 0, nodes);
            } else {
                // The hull seems to have been removed; reset
                selectedHull = null;
                resetGraphView(0);
            }
        } else {
            // Something is wrong with the old selection, reset
            selectedHull = null;
            resetGraphView(0);
        }
    }

}
/**
 * Resets the graph view to its default (unselected) state.
 */
function resetGraphView(duration: number = 300): void {
    // Reset hulls
    hullGroup.selectAll<SVGRectElement, Hull>("rect.hull")
        .transition()
        .duration(duration)
        .style("opacity", d => d.hullType === "combined" ? 0.05 : 1)
        .style("stroke", d => {
            const instanceNode = d.nodes.find(n => n.group === "instance");
            return instanceNode ? color(instanceNode.group) : "#aaa";
        })
        .style("stroke-width", 1);

    // Reset nodes
    nodeGroup.selectAll<SVGGElement, GraphNode>("g")
        .transition()
        .duration(duration)
        .style("opacity", 1);

    // Reset links
    linkGroup.selectAll<SVGLineElement, GraphLink>("line")
        .transition()
        .duration(duration)
        .style("opacity", 1);

    // Reset event-info boxes
    g.selectAll<SVGGElement, any>(".event-info")
        .each(function(d: any) {
            const group = d3.select(this);
            group.selectAll(".event-info-box, .event-info-text")
                .transition()
                .duration(duration)
                .style("opacity", 1);
        });

    // Reset zoom only if this was an interactive reset
    if (duration > 0) {
        svg.transition()
            .duration(750)
            .call(
                (d3.zoom<SVGSVGElement, unknown>() as any).on("zoom", (e: { transform: any; }) => g.attr("transform", String(e.transform))).transform,
                d3.zoomIdentity
            );
    }
}

/**
 * Applies a "selected" view, highlighting a specific hull and its contents.
 */
function applyGraphView(hullToSelect: Hull, duration: number = 300, nodes: GraphNode[]): void {
    const visibleIds = new Set(hullToSelect.nodes.map(n => n.id));

    // Get the instance ID of the selected hull for a stable comparison
    const selectedInstanceId = hullToSelect.nodes.find(n => n.group === 'instance')?.id;

    hullGroup.selectAll<SVGElement, Hull>("rect.hull")
        .transition()
        .duration(duration)
        .style("opacity", d => {
            // Find instance ID of the current hull 'd'
            const currentInstanceId = d.nodes.find(n => n.group === 'instance')?.id;

            // Check if this hull is the selected one by comparing instance ID and type
            if (currentInstanceId && currentInstanceId === selectedInstanceId && d.hullType === hullToSelect.hullType) {
                return 1;
            }

            // For combined view, show related individual hulls
            if (hullToSelect.hullType === "combined") {
                const shared = d.nodes.some(n => visibleIds.has(n.id));
                return shared ? 1 : 0.15;
            }

            // For individual view, fade everything else
            return 0.02;
        })
        .style("stroke", d => {
            const instanceNode = d.nodes.find(n => n.group === "instance");
            return instanceNode ? color(instanceNode.group) : "#aaa";
        })
        .style("stroke-width", d => {
            const currentInstanceId = d.nodes.find(n => n.group === 'instance')?.id;
            if (currentInstanceId && currentInstanceId === selectedInstanceId && d.hullType === hullToSelect.hullType) {
                return 1.5;
            }
            if (hullToSelect.hullType === "combined" && d.nodes.some(n => visibleIds.has(n.id))) {
                return 1.5;
            }
            return 1;
        });

    // --- Handle service nodes ---
    const allServices = nodes.filter(n => n.group === "service");

    // Determine which services should be visible this frame
    const visibleServiceIds = new Set<string>();

    currentData.links.forEach(link => {
        if (typeof link.source === "object" && typeof link.target === "object") {
            if (visibleIds.has(link.source.id) && link.target.group === "service")
                visibleServiceIds.add(link.target.id);
            if (visibleIds.has(link.target.id) && link.source.group === "service")
                visibleServiceIds.add(link.source.id);
        }
    });

    // Compute hull center and radius
    const minX = d3.min(hullToSelect.nodes, n => n.group !== "service" ? n.x ?? 0 : 0) ?? 0;
    const maxX = d3.max(hullToSelect.nodes, n => n.group !== "service" ? n.x ?? 0 : 0) ?? 0;
    const minY = d3.min(hullToSelect.nodes, n => n.group !== "service" ? n.y ?? 0 : 0) ?? 0;
    const maxY = d3.max(hullToSelect.nodes, n => n.group !== "service" ? n.y ?? 0 : 0) ?? 0;

    console.log(hullToSelect)

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const hullRadius = Math.max(maxX - minX, maxY - minY) / 2 + 100;

    // Position visible services in a circle
    const visibleServices = allServices.filter(n => visibleServiceIds.has(n.id));
    const angleStep = (2 * Math.PI) / (visibleServices.length || 1);

    visibleServices.forEach((node, i) => {
        node.x = minX ;
        node.y = minY ;
    });

    // --- Draw or update visible service nodes---
    const serviceSel = nodeGroup
        .selectAll<SVGGElement, GraphNode>("g.service-node")
        .data(visibleServices, d => d.id);

    const serviceEnter = serviceSel.enter()
        .append("g")
        .attr("class", "node service-node")
        .attr("transform", d => `translate(${d.x ?? 0},${d.y ?? 0})`)
        .style("opacity", 0);

    serviceEnter.append("circle")
        .attr("r", 12)
        .style("fill", (d) => (flashingNodes.has(d.id) ? "#FFD700" : color(d.group)))
        .style("stroke", "#555")
        .style("stroke-width", 2);

    serviceEnter.append("text")
        .text(d => d.label)
        .attr("x", 18)
        .attr("y", 5)
        .style("font-size", "12px");

    // Update all service nodes: position + opacity
    serviceSel.merge(serviceEnter)
        .transition()
        .duration(duration)
        .attr("transform", d => `translate(${d.x ?? 0},${d.y ?? 0})`)
        .style("opacity", d => visibleServiceIds.has(d.id) ? 1 : 0.05);

    nodeGroup.selectAll<SVGGElement, GraphNode>("g.node:not(.service-node)")
        .transition()
        .duration(duration)
        .style("opacity", d => visibleIds.has(d.id) ? 1 : 0.15);


    g.selectAll<SVGGElement, any>(".event-info")
        .each(function(d: any) {
            const group = d3.select(this);
            group.selectAll(".event-info-box, .event-info-text")
                .transition()
                .duration(duration)
                .style("opacity", visibleIds.has(d.id) ? 1 : 0.15);
        });

    // Only pan/zoom if this was an interactive click
    if (duration > 0) {
        // Center hull
        const minX = d3.min(hullToSelect.nodes, n => (n.x ?? 0) - (n.group === "instance" ? 20 : 15) - 20) ?? 0;
        const maxX = d3.max(hullToSelect.nodes, n => (n.x ?? 0) + (n.group === "instance" ? 20 : 15) + 20) ?? 0;
        const minY = d3.min(hullToSelect.nodes, n => (n.y ?? 0) - (n.group === "instance" ? 20 : 15) - 20) ?? 0;
        const maxY = d3.max(hullToSelect.nodes, n => (n.y ?? 0) + (n.group === "instance" ? 20 : 15) + 20) ?? 0;

        const hullCenterX = (minX + maxX) / 2;
        const hullCenterY = (minY + maxY) / 2;

        const newTransform = d3.zoomIdentity
            .translate(width / 2 - hullCenterX * 1.2, height / 2 - hullCenterY * 1.2)
            .scale(1.1);

        svg.transition()
            .duration(750)
            .call(
                (d3.zoom<SVGSVGElement, unknown>() as any).on("zoom", (e: { transform: any; }) => g.attr("transform", String(e.transform))).transform,
                newTransform
            );
    }
}
/* ------------------------------ WebSocket ------------------------------- */
const socket = new WebSocket(`ws://${window.location.host}/visual-socket`);

socket.addEventListener("open", () => {
  console.log("WebSocket connection established for live updates.");
});

socket.addEventListener("message", (event) => {
  try {
    const parsed = JSON.parse(event.data) as WebSocketMessage | any;

    switch (parsed.type) {
      case "statusUpdate":
        updateGraph(parsed.payload as GraphData);
        break;
      case "invocation":
        if (parsed.payload?.targetId) flashServiceNode(parsed.payload);
        break;
      default:
        console.warn("Unhandled socket message type:", parsed.type);
    }
  } catch (error) {
    console.error("Error processing WebSocket data:", error);
  }
});
socket.addEventListener("close", (event) => {
  console.log("WebSocket connection closed. Attempting to reconnect in 2 seconds.");
  window.setTimeout(() => {
    window.location.reload();
  }, 2000);
});

socket.addEventListener("error", (error) => {
  console.error("WebSocket error:", error);
});

/* ------------------------------- Exports -------------------------------- */

export { updateGraph, flashServiceNode, setupNodes };
export default {
  updateGraph,
  flashServiceNode,
};
