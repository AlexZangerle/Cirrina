import * as d3 from "d3";
import type {Node as GraphNode, Link as GraphLink, Hull as Hull, GraphData} from "./types.ts";

/** Manage all D3 drawing and DOM manipulations. */
export class GraphRenderer {
  // D3 Selections
  public svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  public g: d3.Selection<SVGGElement, unknown, null, undefined>;
  public tooltip: d3.Selection<HTMLDivElement, unknown, HTMLElement, any>;

  // Element Groups
  public linkGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  public nodeGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  public hullGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  public layoutEllipseGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  public checkboxListGroup!: d3.Selection<SVGGElement, null, SVGSVGElement, unknown>;
  public serviceCheckboxListGroup!: d3.Selection<SVGGElement, null, SVGSVGElement, unknown>;
  public legend!: d3.Selection<SVGGElement, unknown, null, undefined>;

  // Scales
  public color: d3.ScaleOrdinal<string, string, string>;

  // State
  private flashingNodes = new Set<string>();

  constructor(
    container: HTMLElement,
    width: number,
    height: number
  ) {
    // Initialize D3 elements
    this.svg = d3.select<HTMLElement, unknown>(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`);

    this.g = this.svg.append<SVGGElement>("g");
    this.tooltip = d3.select<HTMLDivElement, unknown>("#tooltip");

    this.color = d3.scaleOrdinal<string, string>(d3.schemePaired);

    // Run all setup methods
    this.initDefs();
    this.initGroups(width, height);
    this.initLegend(width);
    this.initCheckboxes(width);
  }

  /** Append the main <g> elements for layering the graph. */
  public initGroups(width: number, height: number): void {
    this.layoutEllipseGroup = this.g.insert<SVGGElement>("g", ".hulls").attr("class", "ellipse");
    this.layoutEllipseGroup.append("ellipse")
      .attr("class", "layout-path-ellipse")
      .attr("cx", width / 2)
      .attr("cy", height / 2);

    this.linkGroup = this.g.append<SVGGElement>("g").attr("class", "links");
    this.nodeGroup = this.g.append<SVGGElement>("g").attr("class", "nodes");
    this.hullGroup = this.g.insert<SVGGElement>("g", ".links").attr("class", "hulls");
  }

  /** Create the legend. */
  public initLegend(width: number): void {
    this.color = d3.scaleOrdinal<string, string>(d3.schemePaired);
    this.legend = this.svg
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
      {type: "title", text: "Node Types"},
      {type: "node", group: "instance", text: "State Machine Instance"},
      {type: "node", group: "state", text: "State"},
      {type: "node", group: "service", text: "Service"},
      {type: "spacer"},
      {type: "title", text: "Node Styles"},
      {type: "style", fill: "#ff050d", text: "Terminal State"},
      {type: "style", fill: "#ff7f0e", stroke: "green", text: "Active State"},
      {type: "style", fill: "#FFD700", text: "Invoked Service (Flash)"},
      {type: "spacer"},
      {type: "title", text: "Link Types"},
      {type: "link", linkType: "transition", text: "Transition"},
      {type: "link", linkType: "contains", text: "Contains"},
      {type: "spacer"},
      {type: "title", text: "Events"},
      {type: "eventBox", text: "Raises Event", color: "steelblue"},
      {type: "eventBox", text: "Receives Event", color: "crimson"},
    ];

    const legendItem = this.legend
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
      .style("fill", (d) => this.color((d as any).group));

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
      .style("stroke", (d) => ((d as any).linkType === "contains" ? "#414743" : "#999"))
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
  }

  /** Create the foreignObject groups for checkboxes. */
  public initCheckboxes(width: number): void {
    this.checkboxListGroup = this.svg.selectAll<SVGGElement, unknown>("g.checkbox-list")
      .data([null])
      .join("g")
      .attr("class", "checkbox-list")
      .attr("transform", `translate(${width - 240}, 450)`);

    this.serviceCheckboxListGroup = this.svg.selectAll<SVGGElement, unknown>("g.service-checkbox-list")
      .data([null])
      .join("g")
      .attr("class", "service-checkbox-list checkbox-list")
      .attr("transform", `translate(${width - 240}, 650)`);
  }

  /** Clear the graph when no nodes are visible. */
  public clearGraph(): void {
    this.hullGroup.selectAll(".hull").data([]).join("rect");
    this.g.selectAll(".event-info").data([]).join(e => e.remove());
    this.layoutEllipseGroup.select(".layout-path-ellipse").style("stroke", "none");
  }

  /** Draw the main layout ellipse. */
  public drawLayoutEllipse(radiusX: number, radiusY: number): void {
    this.layoutEllipseGroup.select(".layout-path-ellipse")
      .attr("rx", radiusX)
      .attr("ry", radiusY)
      .style("fill", "none")
      .style("stroke", "rgba(255, 0, 0, 0.5)")
      .style("stroke-width", 2)
      .style("stroke-dasharray", "10,10");
  }

  /** Draw and updates the hulls. */
  public drawHulls(
    individualHulls: Hull[],
    combinedHulls: Hull[],
    transform: d3.ZoomTransform
  ): void {
    this.hullGroup.selectAll<SVGRectElement, Hull>(".hull-individual")
      .data<Hull>(individualHulls, (d: Hull) => d.id)
      .join("rect")
      .attr("class", "hull-individual hull")
      .style("fill-opacity", 0.15)
      .style("stroke-dasharray", null);

    this.hullGroup.selectAll<SVGRectElement, Hull>(".hull-combined")
      .data<Hull>(combinedHulls, (d: Hull) => d.id)
      .join("rect")
      .attr("class", "hull-combined hull")
      .style("fill-opacity", 0.01)
      .style("stroke-dasharray", "10,10")
      .attr("filter", () => {
        return transform.k < 0.45 ? "url(#hull-shadow)" : null;
      });
  }

  /** Draw and updates the event info boxes. */
  public drawEventInfo(
    nodesWithEvents: GraphNode[],
    raisedBy: Record<string, string[]>,
    receivedBy: Record<string, string[]>
  ): void {
    const infoGroups = this.g.selectAll<SVGGElement, GraphNode>(".event-info")
      .data(nodesWithEvents, d => d.id)
      .join(
        enter => {
          const gEnter = enter.append<SVGGElement>("g").attr("class", "event-info");
          gEnter.append("rect").attr("class", "event-info-box").attr("rx", 6).attr("ry", 6).attr("stroke", "#999").attr("stroke-width", 1);
          return gEnter;
        },
        update => update,
        exit => exit.remove()
      );
    infoGroups.each(function (d) {
      const group = d3.select(this);
      const raised = raisedBy[d.id] || [];
      const received = receivedBy[d.id] || [];
      const lines: string[] = [];
      const lineColors: string[] = [];
      if (raised.length) {
        lines.push(raised.join(", "));
        lineColors.push("steelblue");
      }
      if (received.length) {
        lines.push(received.join(", "));
        lineColors.push("crimson");
      }

      const padding = 6, lineHeight = 15;
      const textWrapper = group.selectAll<SVGGElement, null>(".event-info-box-wrapper").data([null])
        .join("g").attr("class", "event-info-box-wrapper");

      const texts = textWrapper.selectAll<SVGTextElement, string>(".event-info-text")
        .data(lines)
        .join(
          enter => enter.append("text").attr("class", "event-info-text")
            .attr("font-size", 12),
          update => update,
          exit => exit.remove()
        )
        .text(t => t)
        .attr("x", padding)
        .attr("y", (_t, i) => padding + (i + 1) * lineHeight - 2)
        .attr("fill", (_t, i) => lineColors[i]);

      group.select(".event-info-box").lower();
      const wrapperNode = textWrapper.node();
      if (!wrapperNode) return;
      const bbox = wrapperNode.getBBox();
      group.select(".event-info-box")
        .attr("x", bbox.x - padding / 2)
        .attr("y", bbox.y - padding / 2)
        .attr("width", bbox.width + padding)
        .attr("height", bbox.height + padding)
        .attr("fill", "rgba(255,255,255,0.9)");

      group.attr("transform", `translate(${d.x}, ${d.y! - bbox.height - 70})`);
    });
  }

  /** Draw and positions the service nodes around the selection. */
  public drawServiceNodes(
    services: GraphNode[],
    cx: number,
    duration: number
  ): void {
    const serviceSel = this.nodeGroup
      .selectAll<SVGGElement, GraphNode>("g.service-node")
      .data(services, d => (d as GraphNode).id);

    const serviceEnter = serviceSel.enter()
      .append("g")
      .attr("class", "node service-node")
      .attr("transform", d => `translate(${d.x ?? 0},${d.y ?? 0})`)
      .style("opacity", 0);

    serviceEnter.append("circle")
      .attr("r", 12)
      .style("fill", (d) => (this.flashingNodes.has(d.id) ? "#FFD700" : this.color(d.group)))
      .style("stroke", "#555")
      .style("stroke-width", 2);

    serviceEnter.append("text")
      .text(d => d.label)
      .attr("x", d => (d.x ?? 0) < cx ? -18 : 18)
      .attr("y", 5)
      .attr("text-anchor", d => (d.x ?? 0) < cx ? "end" : "start")
      .style("font-size", "12px");

    serviceSel.merge(serviceEnter).select("text")
      .transition()
      .duration(duration)
      .attr("x", d => (d.x ?? 0) < cx ? -18 : 18)
      .attr("text-anchor", d => (d.x ?? 0) < cx ? "end" : "start");

    serviceSel.merge(serviceEnter)
      .transition()
      .duration(duration)
      .attr("transform", d => `translate(${d.x ?? 0},${d.y ?? 0})`)
      .style("opacity", 1);

    serviceSel.exit()
      .transition()
      .duration(duration)
      .style("opacity", 0)
      .remove();
  }

  /** Bind node data and sets up tooltip interactions. */
  public setupNodes(nodes: GraphNode[]): void {
    const sel = this.nodeGroup
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
      this.tooltip
        .transition()
        .duration(200)
        .style("opacity", 0.9);

      let tooltipText = `ID: ${d.label}\nGroup: ${d.group}`;
      if (d.context) {
        tooltipText += `\n\nContext:\n${JSON.stringify(d.context, null, 2)}`;
      }

      this.tooltip
        .html(tooltipText.replace(/\n/g, "<br/>"))
        .style("left", event.pageX + 15 + "px")
        .style("top", event.pageY - 28 + "px");
    }).on("mouseout", () => {
      this.tooltip.transition().duration(500).style("opacity", 0);
    });
  }

  /** Draw and update the links. */
  public drawLinks(links: GraphLink[], getLinkKey: (d: GraphLink) => string): void {
    this.linkGroup.selectAll<SVGLineElement, GraphLink>("line")
      .data(links.filter(l => l.type !== "event-link"))
      .join("line")
      .style("stroke-width", d => d.type === "nested" ? 3 : d.type === "invokes" ? 0 : 1.5)
      .style("stroke", d => d.type === "nested" ? "purple" : d.type === "contains" ? "#414743" : "#999")
      .style("stroke-dasharray", d => d.type === "invokes" || d.type === "nested" ? "5,5" : null)
      .attr("marker-end", d => d.type === "transition" || d.type === "nested" ? "url(#arrowhead)" : null);
  }

  /** Apply styles to nodes. */
  public applyNodeStyles(): void {
    this.nodeGroup
      .selectAll<SVGGElement, GraphNode>("g.node")
      .select<SVGCircleElement>("circle")
      .transition()
      .duration(150)
      .style("fill", d => {
        if (this.flashingNodes.has(d.id)) return "#FFD700";
        if (d.isTerminal) return "#ff050d";
        return this.color(d.group);
      })
      .style("stroke", d => (d.isActive ? "darkgreen" : (d.group === "service") ? "#555" : "#fff"))
      .style("stroke-width", d => (d.isActive ? 4 : 2));
  }

  /** Reposition all graph elements */
  public positionGraph(): void {
    // Hulls
    this.hullGroup.selectAll<SVGRectElement, Hull>(".hull-individual")
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
      .style("stroke", d => {
        const instanceNode = d.nodes.find(n => n.group === "instance");
        return instanceNode ? this.color(instanceNode.group) : "#aaa";
      });

    this.hullGroup.selectAll<SVGRectElement, Hull>(".hull-combined")
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
      .style("stroke", d => {
        const instanceNode = d.nodes.find(n => n.group === "instance");
        return instanceNode ? this.color(instanceNode.group) : "#aaa";
      });

    // Links and Nodes
    this.linkGroup.selectAll("line").attr("x1", (d: any) => d.source.x).attr("y1", (d: any) => d.source.y).attr("x2", (d: any) => d.target.x).attr("y2", (d: any) => d.target.y);
    this.nodeGroup.selectAll("g").attr("transform", (d: any) => `translate(${d.x},${d.y})`);
  }

  /** Apply fading/highlighting to hulls and nodes for selection. */
  public applySelectionView(
    hullToSelect: Hull,
    visibleIds: Set<string>,
    duration: number
  ): void {
    this.hullGroup.selectAll(".hull-combined").attr("filter", null);
    const selectedInstanceId = hullToSelect.nodes.find(n => n.group === 'instance')?.id;

    this.hullGroup.selectAll<SVGElement, Hull>("rect.hull")
      .transition()
      .duration(duration)
      .style("opacity", d => {
        const currentInstanceId = d.nodes.find(n => n.group === 'instance')?.id;
        if (currentInstanceId && currentInstanceId === selectedInstanceId && d.hullType === hullToSelect.hullType) {
          return 1;
        }
        if (hullToSelect.hullType === "combined") {
          const shared = d.nodes.some(n => visibleIds.has(n.id));
          return shared ? 1 : 0.15;
        }
        return 0.02;
      })
      .style("stroke", d => {
        const instanceNode = d.nodes.find(n => n.group === "instance");
        return instanceNode ? this.color(instanceNode.group) : "#aaa";
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

    this.nodeGroup.selectAll<SVGGElement, GraphNode>("g.node:not(.service-node)")
      .transition()
      .duration(duration)
      .style("opacity", d => visibleIds.has(d.id) ? 1 : 0.15);

    this.g.selectAll<SVGGElement, any>(".event-info")
      .each(function (d: any) {
        const group = d3.select(this);
        group.selectAll(".event-info-box, .event-info-text")
          .transition()
          .duration(duration)
          .style("opacity", visibleIds.has(d.id) ? 1 : 0.15);
      });
  }

  /** Show and filter the service checkboxes. */
  public showServiceCheckboxes(visibleServiceIds: Set<string>): void {
    this.serviceCheckboxListGroup.style("display", null);
    this.serviceCheckboxListGroup.selectAll<SVGGElement, GraphNode>("g.checkbox-item")
      .style("display", (d) => visibleServiceIds.has(d.id) ? null : "none");
  }

  /** Attach click handlers to the hull rectangles. */
  public setupHullInteractions(
    hulls: Hull[],
    onClick: (clickedHull: Hull) => void
  ): void {
    this.hullGroup.selectAll<SVGRectElement, Hull>("rect.hull")
      .style("cursor", "pointer")
      .on("click", (event, clickedHull) => {
        event.stopPropagation();
        onClick(clickedHull);
      });
  }

  /** Flash a service node. */
  public flashServiceNode(targetId: string): void {
    this.flashingNodes.add(targetId);
    this.applyNodeStyles();
    window.setTimeout(() => {
      this.flashingNodes.delete(targetId);
      this.applyNodeStyles();
    }, 1000);
  }

  /** Define SVG markers and the shadow for hulls */
  private initDefs(): void {
    const defs = this.svg.append("defs");

    defs.append("marker")
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

    const filter = defs.append("filter")
      .attr("id", "hull-shadow")
      .attr("x", "-40%")
      .attr("y", "-40%")
      .attr("width", "180%")
      .attr("height", "180%");

    // Boost alpha
    filter.append("feColorMatrix")
      .attr("in", "SourceGraphic")
      .attr("type", "matrix")
      .attr("values", "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 100 0")
      .attr("result", "boostedInput");

    // Blur the boosted shape
    filter.append("feGaussianBlur")
      .attr("in", "boostedInput")
      .attr("stdDeviation", "10")
      .attr("result", "blurredShape");

    // Create the shadow
    filter.append("feComposite")
      .attr("operator", "out")
      .attr("in", "blurredShape")
      .attr("in2", "boostedInput")
      .attr("result", "shadowMask");

    // Define the color and opacity
    filter.append("feFlood")
      .attr("flood-color", "#4ebfbb")
      .attr("flood-opacity", 0.5)
      .attr("result", "shadowColor");

    // Cut the shadow so only outside glow remains
    filter.append("feComposite")
      .attr("operator", "in")
      .attr("in", "shadowColor")
      .attr("in2", "shadowMask")
      .attr("result", "finalShadow");

    // Merge shadow and the original
    const merge = filter.append("feMerge");
    merge.append("feMergeNode")
      .attr("in", "finalShadow")
    merge.append("feMergeNode")
      .attr("in", "SourceGraphic");
  }
}