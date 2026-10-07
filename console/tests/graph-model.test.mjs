import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraph } from '../src/graphModel.js';

const mem = (id, parent_id = '', extra = {}) => ({ id, parent_id, title: `mem ${id}`, kind: 'context', importance: 'important', ...extra });

test('keeps every non-trivial memory as a node and links real parent-child pairs', () => {
  const { nodes, links } = buildGraph([mem('a'), mem('b', 'a'), mem('c', 'a')]);
  assert.deepEqual(nodes.map((n) => n.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(links, [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }]);
  assert.equal(nodes.find((n) => n.id === 'a').kind, 'context');
});

test('filters trivial diary entries from nodes and edges', () => {
  const { nodes, links, subtreeSizes } = buildGraph([
    mem('a'),
    mem('d1', 'a', { importance: 'trivial' }),
    mem('b', 'd1', { importance: 'trivial' }),
  ]);
  assert.deepEqual(nodes.map((n) => n.id), ['a']);
  assert.deepEqual(links, []);
  assert.equal(subtreeSizes.get('a'), 1);
});

test('a dangling parent_id leaves the node root-level without an edge', () => {
  const { nodes, links } = buildGraph([mem('a', 'ghost')]);
  assert.deepEqual(nodes.map((n) => n.id), ['a']);
  assert.deepEqual(links, []);
});

test('subtreeSizes counts each node plus all descendants', () => {
  const { subtreeSizes } = buildGraph([
    mem('root'),
    mem('left', 'root'), mem('right', 'root'),
    mem('leaf', 'left'),
  ]);
  assert.equal(subtreeSizes.get('root'), 4);
  assert.equal(subtreeSizes.get('left'), 2);
  assert.equal(subtreeSizes.get('right'), 1);
  assert.equal(subtreeSizes.get('leaf'), 1);
});

test('an empty vault yields an empty model', () => {
  const { nodes, links, subtreeSizes } = buildGraph([]);
  assert.deepEqual(nodes, []);
  assert.deepEqual(links, []);
  assert.equal(subtreeSizes.size, 0);
});
