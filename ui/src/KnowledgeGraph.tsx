import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3-force";

interface GraphNode {
  id: string;
  label: string;
  type: string;
  domain?: string;
  size: number;
  color: string;
  // d3-force adds these
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphEdge {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  label: string;
  weight: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    node_count: number;
    edge_count: number;
    entity_count: number;
    workspace_count: number;
  };
}

interface NodeDetailProps {
  node: GraphNode;
  onClose: () => void;
}

function NodeDetail({ node, onClose }: NodeDetailProps) {
  const domainLabels: Record<string, string> = {
    person: "Person",
    organization: "Organization",
    artifact: "Artifact",
    project: "Project",
    location: "Location",
    concept: "Concept",
    workspace: "Workspace",
  };

  return (
    <div className="graph-node-detail" onClick={(e) => e.stopPropagation()}>
      <div className="graph-node-detail-header">
        <div className="graph-node-avatar" style={{ background: node.color }}>
          {node.label.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <div className="graph-node-detail-name">{node.label}</div>
          <div className="graph-node-detail-type">
            {domainLabels[node.domain ?? node.type] ?? node.type}
          </div>
        </div>
        <button className="graph-close-btn" onClick={onClose}>✕</button>
      </div>
      <div className="graph-node-detail-body">
        <div className="graph-node-detail-row">
          <span className="graph-node-detail-label">ID</span>
          <span className="graph-node-detail-value">{node.id}</span>
        </div>
        <div className="graph-node-detail-row">
          <span className="graph-node-detail-label">Type</span>
          <span className="graph-node-detail-value">{node.type}</span>
        </div>
        {node.domain && (
          <div className="graph-node-detail-row">
            <span className="graph-node-detail-label">Domain</span>
            <span className="graph-node-detail-value">{node.domain}</span>
          </div>
        )}
        <div className="graph-node-detail-row">
          <span className="graph-node-detail-label">Connections</span>
          <span className="graph-node-detail-value">{node.size}</span>
        </div>
      </div>
    </div>
  );
}

export default function KnowledgeGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const animFrameRef = useRef<number>(0);
  const isDragging = useRef(false);
  const dragNode = useRef<GraphNode | null>(null);

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then((data: GraphData) => {
        setGraphData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Draw edges
    for (const edge of edgesRef.current) {
      const src = edge.source as GraphNode;
      const tgt = edge.target as GraphNode;
      if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) continue;

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);

      const edgeColors: Record<string, string> = {
        obligation: "rgba(247,160,74,0.5)",
        co_occurrence: "rgba(124,106,247,0.3)",
        shared_signal: "rgba(59,158,255,0.25)",
        workspace_entity: "rgba(247,224,74,0.4)",
      };
      ctx.strokeStyle = edgeColors[edge.type] ?? "rgba(255,255,255,0.15)";
      ctx.lineWidth = edge.weight * 1.2;
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodesRef.current) {
      if (node.x == null || node.y == null) continue;
      const isSelected = selectedNode?.id === node.id;
      const isHovered = hoveredNode?.id === node.id;
      const r = node.size / 2;

      // Glow for selected/hovered
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = node.color + "44";
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? node.color : node.color + "cc";
      ctx.fill();

      if (isSelected || isHovered) {
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label
      const fontSize = Math.max(9, Math.min(13, r * 0.9));
      ctx.font = `${isSelected ? "600" : "400"} ${fontSize}px -apple-system, sans-serif`;
      ctx.fillStyle = isSelected || isHovered ? "#ffffff" : "rgba(255,255,255,0.75)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Truncate label
      const maxChars = Math.floor(r * 2.2 / (fontSize * 0.55));
      const label = node.label.length > maxChars
        ? node.label.slice(0, maxChars - 1) + "…"
        : node.label;

      // Draw label below node
      ctx.fillText(label, node.x, node.y + r + fontSize + 2);

      // Draw initial inside node
      ctx.font = `bold ${Math.max(8, r * 0.7)}px -apple-system, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(node.label.slice(0, 1).toUpperCase(), node.x, node.y);
    }
  }, [selectedNode, hoveredNode]);

  useEffect(() => {
    if (!graphData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const container = canvas.parentElement!;
    const W = container.clientWidth || window.innerWidth;
    const H = container.clientHeight || window.innerHeight - 120;
    canvas.width = W;
    canvas.height = H;

    // Deep copy nodes and edges for d3
    nodesRef.current = graphData.nodes.map((n) => ({ ...n }));
    edgesRef.current = graphData.edges.map((e) => ({ ...e }));

    // Initialize positions
    nodesRef.current.forEach((n, i) => {
      const angle = (i / nodesRef.current.length) * 2 * Math.PI;
      n.x = W / 2 + Math.cos(angle) * (Math.min(W, H) * 0.3);
      n.y = H / 2 + Math.sin(angle) * (Math.min(W, H) * 0.3);
    });

    const sim = d3.forceSimulation<GraphNode>(nodesRef.current)
      .force("link", d3.forceLink<GraphNode, GraphEdge>(edgesRef.current)
        .id((d) => d.id)
        .distance(100)
        .strength(0.5))
      .force("charge", d3.forceManyBody().strength(-250))
      .force("center", d3.forceCenter(W / 2, H / 2).strength(0.08))
      .force("collision", d3.forceCollide<GraphNode>().radius((d) => d.size / 2 + 18))
      .force("x", d3.forceX(W / 2).strength(0.04))
      .force("y", d3.forceY(H / 2).strength(0.04))
      .alphaDecay(0.02)
      .on("tick", () => {
        // Clamp nodes within canvas bounds
        const pad = 40;
        for (const n of nodesRef.current) {
          if (n.x != null) n.x = Math.max(pad, Math.min(W - pad, n.x));
          if (n.y != null) n.y = Math.max(pad, Math.min(H - pad, n.y));
        }
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(draw);
      });

    simulationRef.current = sim;

    return () => {
      sim.stop();
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [graphData, draw]);

  // Mouse interaction
  const getNodeAtPoint = useCallback((x: number, y: number): GraphNode | null => {
    for (const node of nodesRef.current) {
      if (!node.x || !node.y) continue;
      const dx = x - node.x;
      const dy = y - node.y;
      const r = node.size / 2;
      if (dx * dx + dy * dy <= r * r + 100) return node;
    }
    return null;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isDragging.current && dragNode.current) {
      dragNode.current.fx = x;
      dragNode.current.fy = y;
      simulationRef.current?.alphaTarget(0.1).restart();
      return;
    }

    const node = getNodeAtPoint(x, y);
    setHoveredNode(node);
    if (canvasRef.current) {
      canvasRef.current.style.cursor = node ? "pointer" : "default";
    }
  }, [getNodeAtPoint]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const node = getNodeAtPoint(x, y);
    if (node) {
      isDragging.current = true;
      dragNode.current = node;
      node.fx = node.x;
      node.fy = node.y;
    }
  }, [getNodeAtPoint]);

  const handleMouseUp = useCallback(() => {
    if (dragNode.current) {
      dragNode.current.fx = null;
      dragNode.current.fy = null;
      simulationRef.current?.alphaTarget(0);
    }
    isDragging.current = false;
    dragNode.current = null;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const node = getNodeAtPoint(x, y);
    setSelectedNode(node);
  }, [getNodeAtPoint]);

  // Touch support
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    const node = getNodeAtPoint(x, y);
    if (node) {
      isDragging.current = true;
      dragNode.current = node;
      node.fx = node.x;
      node.fy = node.y;
    }
  }, [getNodeAtPoint]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    if (isDragging.current && dragNode.current) {
      dragNode.current.fx = x;
      dragNode.current.fy = y;
      simulationRef.current?.alphaTarget(0.1).restart();
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const touch = e.changedTouches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    const node = getNodeAtPoint(x, y);
    if (!isDragging.current || (dragNode.current && Math.abs((dragNode.current.x ?? 0) - x) < 5)) {
      setSelectedNode(node);
    }
    if (dragNode.current) {
      dragNode.current.fx = null;
      dragNode.current.fy = null;
      simulationRef.current?.alphaTarget(0);
    }
    isDragging.current = false;
    dragNode.current = null;
  }, [getNodeAtPoint]);

  if (loading) {
    return (
      <div className="graph-loading">
        <div className="graph-loading-spinner" />
        <p>Building knowledge graph…</p>
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="graph-empty">
        <p>No entities to visualize yet.</p>
        <p className="graph-empty-sub">Process some signals to populate the graph.</p>
      </div>
    );
  }

  return (
    <div className="graph-container">
      {/* Legend */}
      <div className="graph-legend">
        {[
          { domain: "person", color: "#7c6af7", label: "Person" },
          { domain: "organization", color: "#3b9eff", label: "Org" },
          { domain: "artifact", color: "#f7a04a", label: "Artifact" },
          { domain: "workspace", color: "#f7e04a", label: "Workspace" },
        ].map((item) => (
          <div key={item.domain} className="graph-legend-item">
            <div className="graph-legend-dot" style={{ background: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      {/* Meta stats */}
      <div className="graph-meta">
        <span>{graphData.meta.node_count} nodes</span>
        <span className="graph-meta-sep">·</span>
        <span>{graphData.meta.edge_count} edges</span>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />

      {/* Node detail panel */}
      {selectedNode && (
        <NodeDetail
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}
