// Graph model for the graph view: derive nodes and parent-child links from the
// decrypted items once, in O(n), and let the view memoize the result.
//
// Unlike the tree view, only trivial diary entries are filtered out. Empty or
// category-description rows stay: in a graph they are still structural
// connection points, and dropping them would fake broken links. A parent_id
// that points at a missing (or trivial-filtered) memory leaves the child as a
// root-level node without an incoming edge, matching the tree view.

/**
 * Build the graph model: nodes, parent-child links and subtree sizes.
 * links only connect a child to a parent that exists among the kept nodes.
 * subtreeSizes counts each node plus its descendants via one bottom-up pass.
 */
export function buildGraph(memories = []) {
  const kept = (memories || []).filter((m) => m && m.id != null && m.importance !== 'trivial');
  const byId = new Set(kept.map((m) => m.id));
  const nodes = kept.map((m) => ({
    id: m.id,
    title: m.title || String(m.id || '').slice(0, 8),
    kind: m.kind || 'context',
  }));
  const kids = new Map(); // parentId to child ids, for the subtree pass
  const parentOf = new Map(); // child id to parent id, for cycle-safe walks
  const links = [];
  kept.forEach((m) => {
    if (!m.parent_id || !byId.has(m.parent_id)) return;
    if (m.parent_id === m.id) return; // Self parentage would poison the size pass
    links.push({ source: m.parent_id, target: m.id });
    if (!kids.has(m.parent_id)) kids.set(m.parent_id, []);
    kids.get(m.parent_id).push(m.id);
    parentOf.set(m.id, m.parent_id);
  });
  const subtreeSizes = new Map();
  // Iterative post-order: parent chains can be long, so avoid deep recursion.
  // onPath guards against parent_id cycles in hand-edited data.
  const onPath = new Set();
  const settle = (id) => {
    let total = 1;
    (kids.get(id) || []).forEach((child) => { total += subtreeSizes.get(child) || 0; });
    subtreeSizes.set(id, total);
  };
  kept.forEach((m) => {
    if (subtreeSizes.has(m.id)) return;
    const stack = [m.id];
    while (stack.length) {
      const id = stack[stack.length - 1];
      if (onPath.has(id)) {
        onPath.delete(id);
        settle(id);
        stack.pop();
        continue;
      }
      if (subtreeSizes.has(id)) { stack.pop(); continue; }
      onPath.add(id);
      (kids.get(id) || []).forEach((child) => {
        if (!subtreeSizes.has(child)) stack.push(child);
      });
    }
  });
  return { nodes, links, subtreeSizes };
}
