export function createCanvasAdapter({ catalog, graphCore }) {
  const definitions = new Map(catalog.definitions.map((item) => [item.id, item]));

  function toCanvasNode(node) {
    const definition = definitions.get(node.definitionId);
    if (!definition) throw new Error(`Unknown NodeDefinition: ${node.definitionId}`);
    return {
      id: node.id,
      type: 'multimodal',
      position: node.position,
      data: { definitionId: node.definitionId, definition, config: node.config || {} },
      dragHandle: '.spike-node-head',
    };
  }

  function toCanvasEdge(edge) {
    return {
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourcePort,
      target: edge.target,
      targetHandle: edge.targetPort,
      type: 'smoothstep',
    };
  }

  function fromWorkflow(workflow) {
    const { nodes, edges, groups = [], pluginDependencies, ...metadata } = workflow;
    const canvasNodes = nodes.map(toCanvasNode);
    for (const group of groups) {
      const members = canvasNodes.filter((node) => group.memberIds?.includes(node.id));
      if (!members.length) continue;
      const minX = group.position?.x ?? Math.min(...members.map((node) => node.position.x)) - 32;
      const minY = group.position?.y ?? Math.min(...members.map((node) => node.position.y)) - 58;
      const width = group.size?.width ?? Math.max(...members.map((node) => node.position.x + 300)) - minX + 32;
      const height = group.size?.height ?? Math.max(...members.map((node) => node.position.y + 230)) - minY + 32;
      const collapsed = Boolean(group.collapsed);
      canvasNodes.unshift({
        id: group.id,
        type: 'multimodalGroup',
        position: { x: minX, y: minY },
        data: { label: group.title || '节点组', collapsed, expandedSize: { width, height }, memberCount: members.length },
        style: { width, height: collapsed ? 58 : height, zIndex: -1 },
        dragHandle: '.spike-group header',
      });
      for (const node of members) {
        node.parentId = group.id;
        node.extent = 'parent';
        node.position = { x: node.position.x - minX, y: node.position.y - minY };
        node.hidden = collapsed;
      }
    }
    return {
      metadata,
      nodes: canvasNodes,
      edges: edges.map(toCanvasEdge),
    };
  }

  function compatibleConnection(connection, nodes, edges, replacingEdgeId = null) {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const source = nodeMap.get(connection.source);
    const target = nodeMap.get(connection.target);
    const sourcePort = source?.data.definition.outputs.find((port) => port.id === connection.sourceHandle);
    const targetPort = target?.data.definition.inputs.find((port) => port.id === connection.targetHandle);
    if (!sourcePort || !targetPort || connection.source === connection.target) return false;
    if (!graphCore.compatible(sourcePort.type, targetPort.type)) return false;
    return targetPort.cardinality !== 'one' || !edges.some((edge) => edge.id !== replacingEdgeId &&
      edge.target === connection.target && edge.targetHandle === connection.targetHandle
    );
  }

  function toWorkflow({ nodes, edges, metadata = {}, absolutePosition = (node) => node.position }) {
    const workflowNodes = nodes.filter((node) => node.type === 'multimodal');
    const groups = nodes.filter((node) => node.type === 'multimodalGroup').map((group) => ({
      id: group.id,
      title: group.data?.label || '节点组',
      memberIds: workflowNodes.filter((node) => node.parentId === group.id).map((node) => node.id),
      collapsed: Boolean(group.data?.collapsed),
      position: clonePosition(group.position),
      size: {
        width: Number(group.data?.expandedSize?.width || group.style?.width) || 0,
        height: Number(group.data?.expandedSize?.height || group.style?.height) || 0,
      },
    }));
    return {
      ...metadata,
      title: metadata.title || 'XYFlow Canvas Adapter',
      nodes: workflowNodes.map((node) => ({
        id: node.id,
        definitionId: node.data.definitionId,
        position: absolutePosition(node),
        config: node.data.config || {},
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        sourcePort: edge.sourceHandle,
        target: edge.target,
        targetPort: edge.targetHandle,
      })),
      ...(groups.length ? { groups } : {}),
      pluginDependencies: workflowNodes
        .filter((node) => node.data.definition.source === 'plugin')
        .map((node) => ({
          definitionId: node.data.definition.id,
          version: node.data.definition.version,
          executorRef: node.data.definition.executorRef,
        })),
    };
  }

  return { definitions, toCanvasNode, toCanvasEdge, fromWorkflow, compatibleConnection, toWorkflow };
}

function clonePosition(position) {
  return { x: position?.x || 0, y: position?.y || 0 };
}
