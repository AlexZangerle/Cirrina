const container = document.getElementById('graph-container');
const width = container.clientWidth;
const height = container.clientHeight;

const svg = d3.select(container).append("svg")
    .attr("width", width)
    .attr("height", height)
    .call(d3.zoom().on("zoom", (event) => g.attr("transform", event.transform)));

const g = svg.append("g");
const tooltip = d3.select("#tooltip");

const linkGroup = g.append("g").attr("class", "links");
const nodeGroup = g.append("g").attr("class", "nodes");

const simulation = d3.forceSimulation()
    .force("link", d3.forceLink().id(d => d.id).distance(120))
    .force("charge", d3.forceManyBody().strength(-350))
    .force("x", d3.forceX(width / 2).strength(0.05))
    .force("y", d3.forceY(height / 2).strength(0.05));

let currentData = { nodes: [], links: [] };

function updateGraph(newData) {
    const oldNodeMap = new Map(currentData.nodes.map(d => [d.id, d]));

    newData.nodes.forEach(node => {
        const oldNode = oldNodeMap.get(node.id);
        if (oldNode) {
            node.x = oldNode.x;
            node.y = oldNode.y;
            node.vx = oldNode.vx;
            node.vy = oldNode.vy;
        }
    });

    currentData = newData;
    const { nodes, links } = currentData;

    const node = nodeGroup.selectAll("g")
        .data(nodes, d => d.id)
        .join(
            enter => {
                const g = enter.append("g").attr("class", "node").call(drag(simulation));
                g.append("circle")
                    .attr("r", d => d.group === 'instance' ? 20 : 15)
                    .attr("fill", d => d.group === 'instance' ? '#ff7f0e' : '#1f77b4');
                g.append("text")
                    .text(d => d.label)
                    .attr('x', 22)
                    .attr('y', 5);
                return g;
            }
        )
        .on("mouseover", (event, d) => {
            tooltip.transition().duration(200).style("opacity", .9);
            let tooltipText = `ID: ${d.label}\nGroup: ${d.group}`;
            if (d.context) {
                tooltipText += `\n\nContext:\n${JSON.stringify(d.context, null, 2)}`;
            }
            tooltip.html(tooltipText)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", () => {
            tooltip.transition().duration(500).style("opacity", 0);
        });

    node.select('circle')
        .transition()
        .duration(1)
        .style("stroke", d => d.isActive ? "green" : "#fff")
        .attr("stroke-width", d => d.isActive ? 4 : 2);

    const link = linkGroup.selectAll("line")
        .data(links, d => `${d.source.id}-${d.target.id}`)
        .join("line")
        .attr("class", "link")
        .attr("stroke-width", 1.5);

    simulation.nodes(nodes).on("tick", () => {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);
        node
            .attr("transform", d => `translate(${d.x},${d.y})`);
    });

    simulation.force("link").links(links);
    simulation.alpha(0.1).restart();
}

async function fetchData() {
    try {
        const response = await fetch('/visual');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        updateGraph(data);
    } catch (error) {
        console.error("Could not fetch status data:", error);
    }
}

fetchData();
setInterval(fetchData, 0);

function drag(simulation) {
    function dragstarted(event) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
    }
    function dragged(event) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
    }
    function dragended(event) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
    }
    return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
}