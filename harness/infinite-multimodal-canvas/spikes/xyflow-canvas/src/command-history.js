function cloneGraph(graph) {
  return structuredClone(graph);
}

function sameGraph(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createCommandHistory(initialGraph, { limit = 100 } = {}) {
  let past = [];
  let future = [];
  let present = cloneGraph(initialGraph);

  function record(type, before, after, meta = {}) {
    if (sameGraph(before, after)) return null;
    const command = {
      id: `command-${Date.now()}-${past.length + 1}`,
      type,
      meta: structuredClone(meta),
      before: cloneGraph(before),
      after: cloneGraph(after),
    };
    past.push(command);
    if (past.length > limit) past = past.slice(-limit);
    future = [];
    present = cloneGraph(after);
    return command;
  }

  function undo() {
    const command = past.pop();
    if (!command) return null;
    future.push(command);
    present = cloneGraph(command.before);
    return { command, graph: cloneGraph(present) };
  }

  function redo() {
    const command = future.pop();
    if (!command) return null;
    past.push(command);
    present = cloneGraph(command.after);
    return { command, graph: cloneGraph(present) };
  }

  function replace(graph) {
    present = cloneGraph(graph);
  }

  function state() {
    return {
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      undoCount: past.length,
      redoCount: future.length,
      lastCommand: past.at(-1)?.type || null,
    };
  }

  return { record, undo, redo, replace, state };
}
