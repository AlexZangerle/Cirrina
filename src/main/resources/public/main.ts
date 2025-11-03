import * as d3 from "d3";
import type {Node as GraphNode, Link as GraphLink, Hull as Hull, GraphData, WebSocketMessage} from "./types.ts";
import {GraphLayoutEngine} from './GraphLayout.ts';
import {GraphRenderer} from './GraphRenderer.ts';
import {GraphState} from "./GraphState.ts";

/** Manage the D3 visualization. */
class GraphVisualizer {

  // Core Properties
  private readonly container: HTMLElement;
  private readonly width: number;
  private readonly height: number;
  private socket: WebSocket;
  private readonly layoutEngine: GraphLayoutEngine;
  private renderer: GraphRenderer;
  private state: GraphState

  // State
  private currentTransform: d3.ZoomTransform = d3.zoomIdentity;
  private zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown>;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) {
      throw new Error(`Element with id '${containerId}' not found.`);
    }
    this.container = el;
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;

    this.layoutEngine = new GraphLayoutEngine(this.width, this.height);
    this.renderer = new GraphRenderer(this.container, this.width, this.height)
    this.state = new GraphState()

    // Init zoom
    this.zoomBehavior = this.initZoom();
    this.applyInitialZoom();

    // Init WebSocket
    this.socket = this.initSocket();
  }

  /**  Flash a service node.*/
  public flashServiceNode(payload: { targetId: string }): void {
    this.renderer.flashServiceNode(payload.targetId)
  }

  /** Re-layout graph by filtering checkboxes */
  public updateGraph(): void {
    // Get user input
    const checkedInstanceIds = new Set<string>();
    this.renderer.checkboxListGroup.selectAll<HTMLInputElement, GraphNode>("g.checkbox-item input:checked")
      .each(function (d) {
        checkedInstanceIds.add(d.id);
      });

    // Update State
    this.state.updateVisibleData(checkedInstanceIds, this.layoutEngine);
    const {nodes, links, combinedHulls, individualHulls, nodesWithEvents, raisedBy, receivedBy} = this.state.visible;

    // Layout
    if (nodes.length === 0) {
      this.renderer.clearGraph();
      this.renderer.positionGraph();
      return;
    }

    // Calculate new positions for visible components
    const {radiusX, radiusY} = this.layoutEngine.positionVisibleComponents(
      nodes, links, this.width, this.height
    );
    this.renderer.drawLayoutEllipse(radiusX, radiusY);

    // Render
    this.renderer.drawHulls(individualHulls, combinedHulls, this.currentTransform);
    this.renderer.drawEventInfo(nodesWithEvents, raisedBy, receivedBy);
    this.renderer.setupNodes(nodes);
    this.renderer.drawLinks(links, this.getLinkKey);
    this.renderer.applyNodeStyles();
    this.renderer.positionGraph();

    // Setup interactions
    this.renderer.setupHullInteractions(
      [...individualHulls, ...combinedHulls],
      (clickedHull) => this.onHullClicked(clickedHull)
    );
    this.updateSelectedHull();
  }

  /**
   * Calculate and assign the layout coordinates for all nodes in the graph.
   *
   * @param data The complete GraphData object containing all nodes and links.
   */
  public calculateLayout(data: GraphData) {
    const {radiusX, radiusY} = this.layoutEngine.calculateLayout(data);
    this.renderer.drawLayoutEllipse(radiusX, radiusY)
  }

  /** Handle click event on a hull. */
  private onHullClicked(clickedHull: Hull): void {
    const selectedHull = this.state.getSelectedHull();

    if (clickedHull.id === selectedHull?.id) {
      this.state.setSelectedHull(null);
      this.resetGraphView();
    } else {
      this.state.setSelectedHull(clickedHull);
      this.applyGraphView(clickedHull);
    }
  }

  /** Re-apply selected hull view if one was selected. */
  private updateSelectedHull(): void {
    const selectedHull = this.state.getSelectedHull();
    if (!selectedHull) return;

    // Get visible nodes and links from state
    const {nodes, links} = this.state.visible;

    const selectedInstanceId = selectedHull.nodes.find(n => n.group === "instance")?.id;
    if (selectedInstanceId) {
      const components = (selectedHull.hullType === "individual")
        ? this.layoutEngine.findConnectedComponents(nodes, links, true)
        : this.layoutEngine.findConnectedComponents(nodes, links, false);

      const newComponents: Hull[] = components.map(c => ({
        id: `hull-${c.map(n => n.id).sort().join("-")}`,
        nodes: c,
        hullType: "combined"
      }));

      // Find the new hull object from visible components
      const newSelectedComponent = newComponents.find(c => c.nodes.some(n => n.id === selectedInstanceId));
      if (newSelectedComponent) {
        this.state.setSelectedHull(newSelectedComponent);
        this.applyGraphView(newSelectedComponent, 0);
      } else {
        // The selected hull is no longer visible
        this.state.setSelectedHull(null);
        this.resetGraphView(0);
      }
    } else {
      // Hull has no instance node
      this.state.setSelectedHull(null);
      this.resetGraphView(0);
    }
  }

  /** Define and apply the zoom behavior. */
  private initZoom(): d3.ZoomBehavior<SVGSVGElement, unknown> {
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .filter((event: UIEvent) => {
        const target = event.target as Element;
        return !(target.closest(".legend") || target.closest(".checkbox-list"));
      })
      .on("start.performance", (event: { transform: d3.ZoomTransform }) => {
        if (event.transform.k >= 0.45) {
          this.renderer.hullGroup.selectAll(".hull-combined").attr("filter", null);
        }
      })
      .on("zoom", (event: { transform: any; }) => {
        this.currentTransform = event.transform;
        this.renderer.g.attr("transform", String(event.transform));
      })
      .on("end.performance", (event: { transform: d3.ZoomTransform; }) => {
        if (event.transform.k < 0.45) {
          this.renderer.hullGroup.selectAll(".hull-combined").attr("filter", "url(#hull-shadow)");
        }
      });
    this.renderer.svg.call(zoom);
    return zoom;
  }

  /** Apply the initial zoomed-out transform. */
  private applyInitialZoom(): void {
    const initialScale = 0.4;
    const initialTransform = d3.zoomIdentity
      .translate((this.width / 2) * (1 - initialScale), (this.height / 4) * (1 - initialScale))
      .scale(initialScale);

    this.renderer.svg.call(this.zoomBehavior.transform as any, initialTransform);
  }

  /** Initialize and connect the WebSocket. */
  private initSocket(): WebSocket {
    const socket = new WebSocket(`ws://${window.location.host}/visual-socket`);

    socket.addEventListener("open", () => {
      console.log("WebSocket connection established for live updates.");
    });

    socket.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data) as WebSocketMessage | any;
        switch (parsed.type) {
          case "initialState":
          case "statusUpdate":
            this.state.setFullData(parsed.payload as GraphData);
            this.calculateLayout(this.state.getFullData());
            this.setupStateMachineCheckbox(
              this.state.getFullData().nodes.filter(n => n.group === "instance")
            );
            this.updateGraph();
            break;
          case "invocation":
            if (parsed.payload?.targetId) this.flashServiceNode(parsed.payload);
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

    return socket;
  }

  /**
   * Generates a unique string key for a given GraphLink object, needed to track which DOM element corresponds to which link
   *
   * @param d One link object from the graph data
   */
  private getLinkKey(d: GraphLink): string {
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
   * Apply a selected view, highlighting a specific hull and its contents.
   *
   * @param hullToSelect Specific hull which should be highlighted
   * @param duration Duration the transition should take, if 0 does not apply zoom
   * @private
   */
  private applyGraphView(hullToSelect: Hull, duration: number = 300): void {
    // Setup view
    const visibleIds = new Set(hullToSelect.nodes.map(n => n.id));
    this.renderer.checkboxListGroup.style("display", "none");
    this.renderer.applySelectionView(hullToSelect, visibleIds, duration);

    // Find visible Services
    const allServices = this.state.getFullData().nodes.filter(n => n.group === "service");
    const visibleServiceIds = new Set<string>();
    const allNodesMap = new Map(this.state.getFullData().nodes.map(n => [n.id, n]));

    this.state.getFullData().links.forEach(link => {
      const sourceId = typeof link.source === 'object' ? link.source.id : (link.source as string);
      const targetId = typeof link.target === 'object' ? link.target.id : (link.target as string);
      const sourceNode = allNodesMap.get(sourceId);
      const targetNode = allNodesMap.get(targetId);
      if (sourceNode && targetNode) {
        if (visibleIds.has(sourceNode.id) && targetNode.group === "service") {
          visibleServiceIds.add(targetNode.id);
        }
        if (visibleIds.has(targetNode.id) && sourceNode.group === "service") {
          visibleServiceIds.add(sourceNode.id);
        }
      }
    });

    let visibleServices = allServices.filter(n => visibleServiceIds.has(n.id));

    // Render and update Service checkboxes
    this.renderer.serviceCheckboxListGroup.style("display", null);

    // Build the service checkboxes
    this.setupDynamicServiceCheckboxes(visibleServices);
    this.updateServiceCheckboxDisabledState(10);

    // Filter visible Services by checkbox selection
    visibleServices = visibleServices.filter(n => {
      const checkBox = document.getElementById(`check-service-${n.id}`) as HTMLInputElement | null;
      return !checkBox || checkBox.checked;
    });

    // Layout Service Nodes
    const {cx} = this.layoutEngine.layoutServiceNodes(hullToSelect.nodes, visibleServices);

    // Render Service Nodes
    this.renderer.drawServiceNodes(visibleServices, cx, duration);

    // Zoom on click
    if (duration > 0) {
      const nonServiceNodes = hullToSelect.nodes.filter(n => n.group !== "service");
      const minX = d3.min(nonServiceNodes, n => (n.x ?? 0) - (n.group === "instance" ? 20 : 15) - 20) ?? 0;
      const maxX = d3.max(nonServiceNodes, n => (n.x ?? 0) + (n.group === "instance" ? 20 : 15) + 20) ?? 0;
      const minY = d3.min(nonServiceNodes, n => (n.y ?? 0) - (n.group === "instance" ? 20 : 15) - 20) ?? 0;
      const maxY = d3.max(nonServiceNodes, n => (n.y ?? 0) + (n.group === "instance" ? 20 : 15) + 20) ?? 0;

      const hullCenterX = (minX + maxX) / 2;
      const hullCenterY = (minY + maxY) / 2;

      const newTransform = d3.zoomIdentity
        .translate(this.width / 2 - hullCenterX, this.height / 2 - hullCenterY)
        .scale(1.1);

      this.currentTransform = newTransform;
      this.renderer.svg.transition()
        .duration(duration)
        .call(this.zoomBehavior.transform as any, newTransform);
    }
  }

  /**
   * Reset graph to default view
   *
   * @param duration Duration the transition takes, if 0 does not reset zoom
   */
  private resetGraphView(duration: number = 300): void {
    if (this.currentTransform)
      this.renderer.hullGroup.selectAll<SVGRectElement, Hull>("rect.hull")
        .transition()
        .duration(duration)
        .style("opacity", d => d.hullType === "combined" ? 1 : 1)
        .style("stroke", d => {
          const instanceNode = d.nodes.find(n => n.group === "instance");
          return instanceNode ? this.renderer.color(instanceNode.group) : "#aaa";
        })
        .style("stroke-width", 1);

    this.renderer.nodeGroup.selectAll<SVGGElement, GraphNode>("g")
      .transition()
      .duration(duration)
      .style("opacity", 1);

    this.renderer.linkGroup.selectAll<SVGLineElement, GraphLink>("line")
      .transition()
      .duration(duration)
      .style("opacity", 1);

    this.renderer.g.selectAll<SVGGElement, any>(".event-info")
      .each(function (d: any) {
        const group = d3.select(this);
        group.selectAll(".event-info-box, .event-info-text")
          .transition()
          .duration(duration)
          .style("opacity", 1);
      });

    this.renderer.checkboxListGroup.style("display", null);
    this.renderer.drawServiceNodes([], 0, 0)

    // Hide the container and destroy all dynamic checkboxes
    this.renderer.serviceCheckboxListGroup.style("display", "none");
    this.renderer.serviceCheckboxListGroup
      .selectAll("g.checkbox-item")
      .data([])
      .join(e => e.remove());

    // Reset zoom only if this was an interactive reset
    if (duration > 0) {
      // Re-apply the initial zoom
      const initialScale = 0.4;
      const initialTransform = d3.zoomIdentity
        .translate((this.width / 2) * (1 - initialScale), (this.height / 4) * (1 - initialScale))
        .scale(initialScale);

      this.renderer.svg.transition()
        .duration(duration)
        .call(this.zoomBehavior.transform as any, initialTransform);

      this.renderer.hullGroup.selectAll(".hull-combined")
        .attr("filter", "url(#hull-shadow)");
    }
  }

  /**
   * Build  the service checkbox list dynamically for the selected hull.
   *
   * @param services The list of service nodes to display.
   */
  private setupDynamicServiceCheckboxes(services: GraphNode[]): void {
    this.renderer.serviceCheckboxListGroup.selectAll<SVGGElement, GraphNode>("g.checkbox-item")
      .data(services, (d: GraphNode): string => d.id)
      .join(
        enter => {
          const g = enter.append("g")
            .attr("class", "checkbox-item")
            .attr("transform", (d, i) => `translate(0, ${i * 25})`);

          const fo = g.append("foreignObject")
            .attr("width", 230).attr("height", 22);

          const div = fo.append("xhtml:div");

          div.append("xhtml:input")
            .attr("type", "checkbox")
            .attr("id", d => `check-service-${d.id}`)
            .property("checked", true)
            .on("change", () => {
              this.updateGraph();
            });

          div.append("xhtml:label")
            .attr("for", d => `check-service-${d.id}`)
            .style("margin-left", "5px")
            .style("font-family", "sans-serif")
            .style("font-size", "14px")
            .style("color", "#333")
            .text(d => d.label);

          return g;
        },
        update =>
          update.attr("transform", (d, i) => `translate(0, ${i * 25})`),
        exit =>
          exit.remove()
      );
  }

  /**
   * Set up checkboxes for state machine selection
   *
   * @param nodes All nodes in the graph, including the instance nodes
   */
  private setupStateMachineCheckbox(nodes: GraphNode[]): void {
    const instanceNodes = nodes.filter(n => n.group === 'instance');
    this.renderer.checkboxListGroup.selectAll<SVGGElement, GraphNode>("g.checkbox-item")
      .data(instanceNodes, (d: GraphNode): string => d.id)
      .join(
        enter => {
          const g = enter.append("g")
            .attr("class", "checkbox-item")
            .attr("transform", (d, i) => `translate(0, ${i * 25})`);

          const fo = g.append("foreignObject")
            .attr("width", 230).attr("height", 22);

          const div = fo.append("xhtml:div");

          div.append("xhtml:input")
            .attr("type", "checkbox")
            .attr("id", d => `check-${d.id}`)
            .property("checked", (d, i) => i < 10)
            .on("change", () => {
              this.updateGraph();
              this.updateCheckboxDisabledState(10);
            });

          div.append("xhtml:label")
            .attr("for", d => `check-${d.id}`)
            .style("margin-left", "5px")
            .style("font-family", "sans-serif")
            .style("font-size", "14px")
            .style("color", "#333")
            .text(d => d.label);

          return g;
        },
        update =>
          update.attr("transform", (d, i) => `translate(0, ${i * 25})`),
        exit =>
          exit.remove()
      );

    this.updateCheckboxDisabledState(10);
  }

  /**
   * Guarantee only a certain amount of state machines can be selected at once
   *
   * @param maxSelectedItems maximum number of items which can be checked at once
   */
  private updateCheckboxDisabledState(maxSelectedItems: number): void {
    const allCheckboxes = this.renderer.checkboxListGroup.selectAll<HTMLInputElement, GraphNode>("g.checkbox-item input");
    const checkedCount = allCheckboxes.filter(":checked").size();

    allCheckboxes.property("disabled", function () {
      const isChecked = (this as HTMLInputElement).checked;
      return checkedCount >= maxSelectedItems && !isChecked;
    });
  }

  /**
   * Guarantee only a certain amount of services can be selected at once
   *
   * @param maxSelectedItems maximum number of items which can be checked at once
   */
  private updateServiceCheckboxDisabledState(maxSelectedItems: number): void {
    // Select all service checkboxes
    const allServiceCheckboxes = this.renderer.serviceCheckboxListGroup
      .selectAll<HTMLInputElement, GraphNode>("g.checkbox-item input");

    // Filter to only visible ones
    const visibleServiceCheckboxes = allServiceCheckboxes
      .filter((d, i, g) => {
        const inputElement = g[i] as HTMLInputElement;
        const parentG = inputElement.closest('g.checkbox-item');
        return !!(parentG && window.getComputedStyle(parentG).display !== "none");
      });

    // Count from only the visible, checked set
    const checkedCount = visibleServiceCheckboxes.filter(":checked").size();

    // Apply disabled only to the visible set
    visibleServiceCheckboxes.property("disabled", function () {
      const isChecked = (this as HTMLInputElement).checked;
      return checkedCount >= maxSelectedItems && !isChecked;
    });
  }
}

export default GraphVisualizer;
