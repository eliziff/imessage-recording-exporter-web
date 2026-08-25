const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
};

const waitForSeek = (video, time) => new Promise((resolve, reject) => {
  const target = Math.min(Math.max(time, 0), Math.max(0, video.duration - 0.02));
  if (Math.abs(video.currentTime - target) < 0.004 && video.readyState >= 2) return resolve();
  const done = () => { cleanup(); resolve(); };
  const failed = () => { cleanup(); reject(new Error("Unable to read a frame from this recording.")); };
  const cleanup = () => {
    video.removeEventListener("seeked", done);
    video.removeEventListener("error", failed);
  };
  video.addEventListener("seeked", done, { once: true });
  video.addEventListener("error", failed, { once: true });
  video.currentTime = target;
});

function rowSignatures(data, width, height) {
  const signatures = new Float32Array(height * 3);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let mean = 0;
    let edge = 0;
    let sides = 0;
    for (let x = 0; x < width; x += 2) {
      const value = data[row + x];
      mean += value;
      if (x + 2 < width) edge += Math.abs(value - data[row + x + 2]);
      sides += value * (x < width / 2 ? 1 : -1);
    }
    const count = Math.ceil(width / 2);
    signatures[y * 3] = mean / count;
    signatures[y * 3 + 1] = edge / count;
    signatures[y * 3 + 2] = sides / count;
  }
  return signatures;
}

function bandSignatureError(first, second, start, found, height) {
  let error = 0;
  let active = 0;
  for (let y = 0; y < height; y += 2) {
    const a = (start + y) * 3;
    const b = (found + y) * 3;
    const weight = Math.max(first.signatures[a + 1], second.signatures[b + 1]) >= 2 ? 1 : 0.12;
    error += weight * (
      Math.abs(first.signatures[a] - second.signatures[b]) * 0.15
      + Math.abs(first.signatures[a + 1] - second.signatures[b + 1])
      + Math.abs(first.signatures[a + 2] - second.signatures[b + 2]) * 0.2
    );
    active += weight;
  }
  return error / Math.max(active, 1);
}

function pixelError(first, second, shift) {
  const overlap = first.height - Math.abs(shift);
  const firstY = shift >= 0 ? 0 : -shift;
  const secondY = shift >= 0 ? shift : 0;
  const errors = [];
  for (let row = 0; row < 5; row += 1) {
    const y0 = Math.floor(row * overlap / 5);
    const y1 = Math.floor((row + 1) * overlap / 5);
    for (let column = 0; column < 4; column += 1) {
      const x0 = Math.floor(column * first.width / 4);
      const x1 = Math.floor((column + 1) * first.width / 4);
      let difference = 0;
      let sumA = 0;
      let sumB = 0;
      let squareA = 0;
      let squareB = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 2) {
        const firstRow = (firstY + y) * first.width;
        const secondRow = (secondY + y) * second.width;
        for (let x = x0; x < x1; x += 3) {
          const a = first.data[firstRow + x];
          const b = second.data[secondRow + x];
          difference += Math.abs(a - b);
          sumA += a;
          sumB += b;
          squareA += a * a;
          squareB += b * b;
          count += 1;
        }
      }
      const varianceA = squareA / count - (sumA / count) ** 2;
      const varianceB = squareB / count - (sumB / count) ** 2;
      if (Math.sqrt(Math.max(varianceA, varianceB, 0)) >= 8) errors.push(difference / count);
    }
  }
  return errors.length ? median(errors) : Infinity;
}

function measuredDelta(first, second, rawFrameHeight, scale) {
  const candidates = [];
  const templateHeight = Math.max(24, Math.round(first.height * 0.13));
  const starts = new Set(Array.from({ length: 7 }, (_, index) => Math.round(index * (first.height - templateHeight) / 6)));
  for (const start of starts) {
    let templateEdge = 0;
    for (let y = start; y < start + templateHeight; y += 1) templateEdge += first.signatures[y * 3 + 1];
    if (templateEdge / templateHeight < 1.5) continue;
    let bestFound = 0;
    let bestSignature = Infinity;
    for (let found = 0; found <= second.height - templateHeight; found += 2) {
      const error = bandSignatureError(first, second, start, found, templateHeight);
      if (error < bestSignature) { bestSignature = error; bestFound = found; }
    }
    let refinedFound = bestFound;
    for (let found = Math.max(0, bestFound - 3); found <= Math.min(second.height - templateHeight, bestFound + 3); found += 1) {
      const error = bandSignatureError(first, second, start, found, templateHeight);
      if (error < bestSignature) { bestSignature = error; refinedFound = found; }
    }
    candidates.push({ shift: refinedFound - start, signature: bestSignature });
  }
  if (!candidates.length) return null;
  const ranked = candidates.map(candidate => ({ ...candidate, error: pixelError(first, second, candidate.shift) })).sort((a, b) => a.error - b.error);
  const best = ranked[0];
  if (!best || best.error > 20) return null;
  const cluster = candidates.filter(candidate => Math.abs(candidate.shift - best.shift) <= 5);
  if (cluster.length < 2 && best.error > 4) return null;
  const viewportDelta = -median(cluster.map(candidate => candidate.shift)) / scale;
  if (Math.abs(viewportDelta) >= rawFrameHeight * 0.94) return null;
  return { delta: viewportDelta, score: 100 * cluster.length / (1 + best.error) };
}

export function solvePositions(frameCount, edges) {
  const neighbors = Array.from({ length: frameCount }, () => new Set());
  for (const edge of edges) {
    neighbors[edge.first].add(edge.second);
    neighbors[edge.second].add(edge.first);
  }
  const unseen = new Set(Array.from({ length: frameCount }, (_, index) => index));
  const components = [];
  while (unseen.size) {
    const seed = unseen.values().next().value;
    unseen.delete(seed);
    const component = [seed];
    const stack = [seed];
    while (stack.length) {
      const node = stack.pop();
      for (const found of neighbors[node]) {
        if (!unseen.delete(found)) continue;
        component.push(found);
        stack.push(found);
      }
    }
    components.push(component.sort((a, b) => a - b));
  }
  const nodes = components.sort((a, b) => b.length - a.length || b.reduce((n, i) => n + neighbors[i].size, 0) - a.reduce((n, i) => n + neighbors[i].size, 0))[0];
  const nodeSet = new Set(nodes);
  const componentEdges = edges.filter(edge => nodeSet.has(edge.first) && nodeSet.has(edge.second));
  const parent = new Map(nodes.map(node => [node, node]));
  const root = node => {
    let current = node;
    while (parent.get(current) !== current) current = parent.get(current);
    while (parent.get(node) !== node) {
      const next = parent.get(node);
      parent.set(node, current);
      node = next;
    }
    return current;
  };
  const tree = [];
  for (const edge of [...componentEdges].sort((a, b) => b.score - a.score)) {
    const firstRoot = root(edge.first);
    const secondRoot = root(edge.second);
    if (firstRoot === secondRoot) continue;
    parent.set(firstRoot, secondRoot);
    tree.push(edge);
    if (tree.length === nodes.length - 1) break;
  }
  if (tree.length !== nodes.length - 1) throw new Error("The recording does not contain enough overlapping frames to build a sequence.");
  const adjacency = new Map(nodes.map(node => [node, []]));
  for (const edge of tree) {
    adjacency.get(edge.first).push([edge.second, edge.delta]);
    adjacency.get(edge.second).push([edge.first, -edge.delta]);
  }
  const position = new Map([[nodes[0], 0]]);
  const stack = [nodes[0]];
  while (stack.length) {
    const node = stack.pop();
    for (const [other, delta] of adjacency.get(node)) {
      if (position.has(other)) continue;
      position.set(other, position.get(node) + delta);
      stack.push(other);
    }
  }
  const activeEdges = componentEdges.filter(edge => Math.abs(position.get(edge.second) - position.get(edge.first) - edge.delta) <= 14);
  const anchor = nodes[0];
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const next = new Map([[anchor, 0]]);
    for (const node of nodes) {
      if (node === anchor) continue;
      let total = 0.35;
      let sum = position.get(node) * total;
      for (const edge of activeEdges) {
        const weight = Math.min(Math.sqrt(edge.score), 8);
        if (edge.first === node) { sum += (position.get(edge.second) - edge.delta) * weight; total += weight; }
        if (edge.second === node) { sum += (position.get(edge.first) + edge.delta) * weight; total += weight; }
      }
      next.set(node, sum / total);
    }
    for (const [node, value] of next) position.set(node, value);
  }
  return { nodes, positions: nodes.map(node => position.get(node)), activeEdges, componentCount: components.length };
}

function detectContentBand(features) {
  const height = features[0].height;
  const width = features[0].width;
  const activity = new Float64Array(height);
  let comparisons = 0;
  const stride = Math.max(1, Math.floor((features.length - 1) / 24));
  for (let index = 0; index + stride < features.length; index += stride) {
    const first = features[index].data;
    const second = features[index + stride].data;
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      const offset = y * width;
      for (let x = 0; x < width; x += 3) sum += Math.abs(first[offset + x] - second[offset + x]);
      activity[y] += sum / Math.ceil(width / 3);
    }
    comparisons += 1;
  }
  const smoothed = Array.from(activity, value => value / comparisons);
  const radius = Math.max(3, Math.round(height * 0.008));
  const moving = smoothed.map((_, y) => {
    let sum = 0;
    let count = 0;
    for (let row = Math.max(0, y - radius); row <= Math.min(height - 1, y + radius); row += 1) { sum += smoothed[row]; count += 1; }
    return sum / count;
  });
  const low = quantile(moving, 0.2);
  const high = quantile(moving, 0.8);
  const threshold = Math.max(3, low + (high - low) * 0.32);
  const window = Math.max(8, Math.round(height * 0.025));
  const windowMoves = start => moving.slice(start, start + window).filter(value => value >= threshold).length >= window * 0.55;
  let top = -1;
  for (let y = 0; y < Math.floor(height * 0.38) && y + window < height; y += 1) {
    if (windowMoves(y)) { top = y; break; }
  }
  let bottom = -1;
  for (let y = height - window; y > Math.floor(height * 0.62); y -= 1) {
    if (windowMoves(y)) { bottom = y + window; break; }
  }
  if (top < 0 || bottom < 0 || bottom - top < height * 0.35) return { top: 0.12, bottom: 0.16, automatic: false };
  return {
    top: Math.max(0.1, top / height),
    bottom: Math.max(0.12, 1 - bottom / height),
    automatic: true,
  };
}

async function sampleFeatures(video, canvas, scale, report) {
  const duration = video.duration;
  const interval = Math.min(0.35, Math.max(0.12, duration / 80));
  const times = [];
  for (let time = Math.min(0.04, duration / 4); time < duration - 0.01; time += interval) times.push(time);
  if (times.length < 2) throw new Error("This recording is too short to process.");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const mats = [];
  for (let index = 0; index < times.length; index += 1) {
    await waitForSeek(video, times[index]);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const gray = new Uint8Array(canvas.width * canvas.height);
    for (let pixel = 0, target = 0; pixel < rgba.length; pixel += 4, target += 1) {
      gray[target] = Math.round(rgba[pixel] * 0.299 + rgba[pixel + 1] * 0.587 + rgba[pixel + 2] * 0.114);
    }
    mats.push({
      width: canvas.width,
      height: canvas.height,
      data: gray,
      signatures: rowSignatures(gray, canvas.width, canvas.height),
    });
    if (index % 5 === 0 || index === times.length - 1) report(8 + 24 * (index + 1) / times.length, `Reading frames… ${index + 1} of ${times.length}`);
  }
  return { mats, times, interval };
}

function cropFeatures(features, band) {
  const height = features[0].height;
  const start = Math.round(height * band.top);
  const end = Math.round(height * (1 - band.bottom));
  return features.map(feature => {
    const data = feature.data.slice(start * feature.width, end * feature.width);
    return {
      width: feature.width,
      height: end - start,
      data,
      signatures: rowSignatures(data, feature.width, end - start),
    };
  });
}

function positionFrames(features, rawFrameHeight, scale, report) {
  const edges = [];
  const strides = [1, 2, 4, 8];
  for (let index = 0; index < features.length; index += 1) {
    for (const stride of strides) {
      const other = index + stride;
      if (other >= features.length) continue;
      const match = measuredDelta(features[index], features[other], rawFrameHeight, scale);
      if (match) edges.push({ first: index, second: other, ...match });
    }
    if (index % 4 === 0 || index === features.length - 1) report(34 + 43 * (index + 1) / features.length, `Matching repeated frames… ${index + 1} of ${features.length}`);
  }
  if (!edges.length) throw new Error("No repeated frames were found. Scroll more slowly so adjacent views overlap.");
  return { ...solvePositions(features.length, edges), edgeCount: edges.length };
}

function groupedPlacements(nodes, positions) {
  const minimum = Math.min(...positions);
  const placements = nodes.map((node, index) => ({ node, y: Math.round(positions[index] - minimum) })).sort((a, b) => a.y - b.y || a.node - b.node);
  const grouped = [];
  for (const placement of placements) {
    if (grouped.length && placement.y - grouped[grouped.length - 1].y <= 12) grouped[grouped.length - 1] = placement;
    else grouped.push(placement);
  }
  return grouped;
}

function bestSeam(output, frame, outputY, frameY, width, overlap) {
  if (overlap < 12) return Math.max(0, Math.floor(overlap / 2));
  const compareWidth = Math.min(220, width);
  const compareHeight = Math.max(1, Math.round(overlap * compareWidth / width));
  const first = document.createElement("canvas");
  const second = document.createElement("canvas");
  first.width = second.width = compareWidth;
  first.height = second.height = compareHeight;
  first.getContext("2d").drawImage(output, 0, outputY, width, overlap, 0, 0, compareWidth, compareHeight);
  second.getContext("2d").drawImage(frame, 0, frameY, width, overlap, 0, 0, compareWidth, compareHeight);
  const a = first.getContext("2d").getImageData(0, 0, compareWidth, compareHeight).data;
  const b = second.getContext("2d").getImageData(0, 0, compareWidth, compareHeight).data;
  const errors = [];
  for (let y = 0; y < compareHeight; y += 1) {
    let sum = 0;
    for (let x = 0; x < compareWidth; x += 2) {
      const offset = (y * compareWidth + x) * 4;
      sum += Math.abs(a[offset] - b[offset]) + Math.abs(a[offset + 1] - b[offset + 1]) + Math.abs(a[offset + 2] - b[offset + 2]);
    }
    errors.push(sum / Math.ceil(compareWidth / 2));
  }
  const radius = Math.max(1, Math.round(compareHeight * 0.04));
  const margin = Math.min(Math.max(radius * 2, Math.round(compareHeight * 0.08)), Math.floor(compareHeight / 3));
  let best = margin;
  let bestError = Infinity;
  for (let y = margin; y < compareHeight - margin; y += 1) {
    let sum = 0;
    let count = 0;
    for (let row = Math.max(0, y - radius); row <= Math.min(compareHeight - 1, y + radius); row += 1) { sum += errors[row]; count += 1; }
    if (sum / count < bestError) { bestError = sum / count; best = y; }
  }
  return Math.round(best * overlap / compareHeight);
}

async function composite(video, frameCanvas, times, band, graph, report) {
  const cropTop = Math.round(video.videoHeight * band.top);
  const cropBottom = Math.round(video.videoHeight * band.bottom);
  const frameHeight = video.videoHeight - cropTop - cropBottom;
  const placements = groupedPlacements(graph.nodes, graph.positions);
  const outputHeight = Math.ceil(Math.max(...placements.map(item => item.y)) + video.videoHeight);
  if (outputHeight > 32700) throw new Error("The stitched conversation is too tall for this browser. Use a shorter recording or split it into two recordings.");
  const output = document.createElement("canvas");
  output.width = video.videoWidth;
  output.height = outputHeight;
  const outputContext = output.getContext("2d", { alpha: false });
  outputContext.fillStyle = "white";
  outputContext.fillRect(0, 0, output.width, output.height);
  frameCanvas.width = video.videoWidth;
  frameCanvas.height = video.videoHeight;
  const frameContext = frameCanvas.getContext("2d", { alpha: false });
  let canvasEnd = 0;
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    await waitForSeek(video, times[placement.node]);
    frameContext.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
    if (!canvasEnd) {
      outputContext.drawImage(frameCanvas, 0, 0, output.width, cropTop, 0, 0, output.width, cropTop);
      outputContext.drawImage(frameCanvas, 0, cropTop, output.width, frameHeight, 0, cropTop + placement.y, output.width, frameHeight);
      canvasEnd = cropTop + placement.y + frameHeight;
    } else if (cropTop + placement.y + frameHeight > canvasEnd) {
      const outputY = cropTop + placement.y;
      const overlap = Math.max(0, canvasEnd - outputY);
      const seam = overlap ? bestSeam(output, frameCanvas, outputY, cropTop, output.width, overlap) : 0;
      const sourceY = cropTop + seam;
      outputContext.drawImage(frameCanvas, 0, sourceY, output.width, frameHeight - seam, 0, outputY + seam, output.width, frameHeight - seam);
      canvasEnd = outputY + frameHeight;
    }
    report(78 + 20 * (index + 1) / placements.length, `Building the export… ${index + 1} of ${placements.length}`);
  }
  outputContext.drawImage(frameCanvas, 0, video.videoHeight - cropBottom, output.width, cropBottom, 0, canvasEnd, output.width, cropBottom);
  return { output, placements, frameHeight };
}

export async function stitchRecording(video, canvas, report = () => {}) {
  const scale = video.videoWidth > 900 ? 0.25 : 0.4;
  report(4, "Preparing the recording…");
  const sampled = await sampleFeatures(video, canvas, scale, report);
  const band = detectContentBand(sampled.mats);
  report(33, band.automatic ? "Found the scrolling conversation area." : "Using the standard Messages conversation area.");
  const cropped = cropFeatures(sampled.mats, band);
  const graph = positionFrames(cropped, video.videoHeight * (1 - band.top - band.bottom), scale, report);
  const composited = await composite(video, canvas, sampled.times, band, graph, report);
  const diagnostics = {
    durationSeconds: Number(video.duration.toFixed(2)),
    sampledFrames: sampled.times.length,
    positionedFrames: graph.nodes.length,
    reliableMatches: graph.edgeCount,
    connectedSections: graph.componentCount,
    connectedPercent: Math.round(graph.nodes.length / sampled.times.length * 100),
    timelineGaps: graph.nodes[graph.nodes.length - 1] - graph.nodes[0] + 1 - graph.nodes.length,
    positionSpanPixels: Math.round(Math.max(...graph.positions) - Math.min(...graph.positions)),
    crop: { topPercent: Math.round(band.top * 100), bottomPercent: Math.round(band.bottom * 100), automatic: band.automatic },
    outputPixels: [composited.output.width, composited.output.height],
  };
  report(100, "Export ready.");
  return { canvas: composited.output, diagnostics };
}
