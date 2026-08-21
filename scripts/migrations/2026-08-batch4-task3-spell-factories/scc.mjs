/** Tarjan's SCC over a small directed graph: Map<node, Set<node>>. Returns array of groups (each a Set), size 1 included. */
export function stronglyConnectedComponents(graph) {
  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const result = [];

  function strongconnect(v) {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of graph.get(v) || []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component = new Set();
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        component.add(w);
      } while (w !== v);
      result.push(component);
    }
  }

  for (const v of graph.keys()) {
    if (!indices.has(v)) strongconnect(v);
  }
  return result;
}
