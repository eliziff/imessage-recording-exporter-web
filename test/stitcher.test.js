import test from "node:test";
import assert from "node:assert/strict";
import { solvePositions } from "../stitcher.js";

test("solves a scrolling sequence that reverses direction", () => {
  const expected = [0, 240, 520, 310, 670, 900];
  const edges = [];
  for (let first = 0; first < expected.length; first += 1) {
    for (const stride of [1, 2, 4]) {
      const second = first + stride;
      if (second < expected.length) edges.push({ first, second, delta: expected[second] - expected[first], score: 10 - stride });
    }
  }
  const result = solvePositions(expected.length, edges);
  assert.deepEqual(result.nodes, [0, 1, 2, 3, 4, 5]);
  result.positions.forEach((position, index) => assert.ok(Math.abs(position - expected[index]) < 0.01));
});

test("uses the largest connected section when a recording contains a jump", () => {
  const result = solvePositions(5, [
    { first: 0, second: 1, delta: 100, score: 5 },
    { first: 1, second: 2, delta: 100, score: 5 },
    { first: 3, second: 4, delta: 100, score: 5 },
  ]);
  assert.deepEqual(result.nodes, [0, 1, 2]);
  assert.equal(result.componentCount, 2);
});
