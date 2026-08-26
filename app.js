import { stitchRecording } from "./stitcher.js";

const elements = {
  file: document.querySelector("#recording"),
  fileName: document.querySelector("#file-name"),
  fileError: document.querySelector("#file-error"),
  baseName: document.querySelector("#base-name"),
  process: document.querySelector("#process"),
  progressSection: document.querySelector("#progress-section"),
  progress: document.querySelector("#progress"),
  status: document.querySelector("#status"),
  results: document.querySelector("#results"),
  summary: document.querySelector("#result-summary"),
  preview: document.querySelector("#preview"),
  continuous: document.querySelector("#continuous-download"),
  zip: document.querySelector("#zip-download"),
  pdf: document.querySelector("#pdf-download"),
  diagnostics: document.querySelector("#diagnostics"),
  startOver: document.querySelector("#start-over"),
  video: document.querySelector("#video"),
  canvas: document.querySelector("#work-canvas"),
  clipStart: document.querySelector("#clip-start"),
  clipEnd: document.querySelector("#clip-end"),
  setStart: document.querySelector("#set-start"),
  setEnd: document.querySelector("#set-end"),
  videoDownload: document.querySelector("#video-download"),
  audioDownload: document.querySelector("#audio-download"),
  mediaStatus: document.querySelector("#media-status"),
};

const state = {
  urls: [],
  pageBlobs: [],
  baseName: "message-export",
  sourceFile: null,
  mediaFfmpeg: null,
  mediaInputName: "",
  mediaJob: "",
  videoNumber: 1,
  audioNumber: 1,
};

function report(percent, message) {
  elements.progress.value = percent;
  elements.progress.textContent = String(Math.round(percent));
  elements.status.textContent = message;
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

function cleanBaseName(value) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80) || "message-export";
}

function numberedName(kind, number, extension) {
  return `${state.baseName}-${kind}-${String(number).padStart(4, "0")}.${extension}`;
}

function loadScript(source) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${source}"]`);
    if (existing) return existing.dataset.loaded ? resolve() : existing.addEventListener("load", resolve, { once: true });
    const script = document.createElement("script");
    script.src = source;
    script.addEventListener("load", () => { script.dataset.loaded = "true"; resolve(); }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Unable to load ${source}. Refresh the page and try again.`)), { once: true });
    document.head.append(script);
  });
}

function loadVideoSource(video, source, timeout = 12000) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("loadeddata", loaded);
      video.removeEventListener("error", failed);
    };
    const loaded = () => {
      cleanup();
      if (!video.videoWidth || !video.videoHeight) reject(new Error("The browser could not decode this video."));
      else resolve();
    };
    const failed = () => { cleanup(); reject(new Error("The browser could not decode this video.")); };
    video.addEventListener("loadeddata", loaded, { once: true });
    video.addEventListener("error", failed, { once: true });
    timer = setTimeout(failed, timeout);
    video.src = source;
    video.load();
  });
}

async function convertForBrowser(file) {
  report(3, "Loading the video converter…");
  const [{ FFmpeg }, { fetchFile }] = await Promise.all([
    import("./vendor/ffmpeg/index.js"),
    import("./vendor/ffmpeg-util/index.js"),
  ]);
  const ffmpeg = new FFmpeg();
  ffmpeg.on("progress", ({ progress }) => report(3 + Math.max(0, Math.min(1, progress)) * 22, `Converting video… ${Math.round(progress * 100)}%`));
  await ffmpeg.load({
    coreURL: new URL("./vendor/ffmpeg-core/ffmpeg-core.js", import.meta.url).href,
    wasmURL: new URL("./vendor/ffmpeg-core/ffmpeg-core.wasm", import.meta.url).href,
  });
  const inputName = file.name.toLowerCase().endsWith(".mov") ? "input.mov" : "input.mp4";
  await ffmpeg.writeFile(inputName, await fetchFile(file));
  const exitCode = await ffmpeg.exec(["-i", inputName, "-vf", "fps=12", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "converted.mp4"]);
  if (exitCode !== 0) {
    ffmpeg.terminate();
    throw new Error("Unable to convert this recording. Convert it to H.264 and try again.");
  }
  const bytes = await ffmpeg.readFile("converted.mp4");
  ffmpeg.terminate();
  return new Blob([bytes], { type: "video/mp4" });
}

async function prepareVideo(file) {
  const originalUrl = URL.createObjectURL(file);
  state.urls.push(originalUrl);
  try {
    await loadVideoSource(elements.video, originalUrl);
    return "native";
  } catch {
    const converted = await convertForBrowser(file);
    const convertedUrl = URL.createObjectURL(converted);
    state.urls.push(convertedUrl);
    await loadVideoSource(elements.video, convertedUrl, 20000);
    return "converted";
  }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The browser could not create an export image.")), type, quality));
}

async function buildDownloads(canvas) {
  report(99, "Creating export files…");
  const continuousBlob = await canvasBlob(canvas, "image/jpeg", 0.92);
  const continuousUrl = URL.createObjectURL(continuousBlob);
  state.urls.push(continuousUrl);
  elements.continuous.href = continuousUrl;
  elements.continuous.download = `${state.baseName}-contiguous.jpg`;
  elements.preview.src = continuousUrl;

  const pageHeight = 2400;
  state.pageBlobs = [];
  for (let start = 0; start < canvas.height; start += pageHeight) {
    const page = document.createElement("canvas");
    page.width = canvas.width;
    page.height = Math.min(pageHeight, canvas.height - start);
    page.getContext("2d", { alpha: false }).drawImage(canvas, 0, start, canvas.width, page.height, 0, 0, canvas.width, page.height);
    state.pageBlobs.push(await canvasBlob(page, "image/png"));
    await nextFrame();
  }

  const { zipSync } = await import("./vendor/fflate/browser.js");
  const files = {};
  for (let index = 0; index < state.pageBlobs.length; index += 1) {
    files[numberedName("image", index + 1, "png")] = new Uint8Array(await state.pageBlobs[index].arrayBuffer());
  }
  const zipBlob = new Blob([zipSync(files, { level: 0 })], { type: "application/zip" });
  const zipUrl = URL.createObjectURL(zipBlob);
  state.urls.push(zipUrl);
  elements.zip.href = zipUrl;
  elements.zip.download = `${state.baseName}-images.zip`;
}

async function downloadPdf() {
  const originalLabel = elements.pdf.textContent;
  elements.pdf.disabled = true;
  elements.pdf.textContent = "Creating PDF…";
  try {
    if (!window.jspdf) await loadScript("vendor/jspdf/jspdf.umd.min.js");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter", compress: true });
    const margin = 28;
    const usableWidth = 612 - margin * 2;
    const usableHeight = 792 - margin * 2;
    for (let index = 0; index < state.pageBlobs.length; index += 1) {
      if (index) pdf.addPage("letter", "portrait");
      const imageUrl = URL.createObjectURL(state.pageBlobs[index]);
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = imageUrl;
      });
      const height = Math.min(usableHeight, image.height * usableWidth / image.width);
      pdf.addImage(image, "PNG", margin, margin, usableWidth, height, undefined, "FAST");
      URL.revokeObjectURL(imageUrl);
    }
    pdf.save(`${state.baseName}-paginated.pdf`);
  } catch (error) {
    elements.fileError.textContent = `Unable to create the PDF. ${error.message || "Download the image ZIP instead."}`;
  } finally {
    elements.pdf.disabled = false;
    elements.pdf.textContent = originalLabel;
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  state.urls.push(url);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
}

function clipRange() {
  const start = Number(elements.clipStart.value);
  const end = Number(elements.clipEnd.value);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > elements.video.duration + 0.05) {
    throw new Error(`Use a start and end between 0 and ${elements.video.duration.toFixed(1)} seconds.`);
  }
  return { start, duration: end - start };
}

async function getMediaFfmpeg() {
  if (state.mediaFfmpeg) return state.mediaFfmpeg;
  elements.mediaStatus.textContent = "Loading media tools…";
  const [{ FFmpeg }, { fetchFile }] = await Promise.all([
    import("./vendor/ffmpeg/index.js"),
    import("./vendor/ffmpeg-util/index.js"),
  ]);
  const ffmpeg = new FFmpeg();
  ffmpeg.on("progress", ({ progress }) => {
    if (state.mediaJob) elements.mediaStatus.textContent = `Creating ${state.mediaJob}… ${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  });
  await ffmpeg.load({
    coreURL: new URL("./vendor/ffmpeg-core/ffmpeg-core.js", import.meta.url).href,
    wasmURL: new URL("./vendor/ffmpeg-core/ffmpeg-core.wasm", import.meta.url).href,
  });
  state.mediaInputName = state.sourceFile.name.toLowerCase().endsWith(".mov") ? "media-input.mov" : "media-input.mp4";
  elements.mediaStatus.textContent = "Reading recording…";
  await ffmpeg.writeFile(state.mediaInputName, await fetchFile(state.sourceFile));
  state.mediaFfmpeg = ffmpeg;
  return ffmpeg;
}

async function downloadMedia(kind) {
  elements.fileError.textContent = "";
  elements.mediaStatus.textContent = "";
  let range;
  try {
    range = clipRange();
  } catch (error) {
    elements.mediaStatus.textContent = error.message;
    elements.clipStart.focus();
    return;
  }

  const button = kind === "video" ? elements.videoDownload : elements.audioDownload;
  const originalLabel = button.textContent;
  elements.videoDownload.disabled = true;
  elements.audioDownload.disabled = true;
  state.mediaJob = `${kind} clip`;
  button.textContent = `Creating ${kind} clip…`;
  const extension = kind === "video" ? "mp4" : "m4a";
  const outputName = `media-output.${extension}`;
  try {
    const ffmpeg = await getMediaFfmpeg();
    const common = ["-ss", range.start.toFixed(3), "-t", range.duration.toFixed(3), "-i", state.mediaInputName];
    const options = kind === "video"
      ? ["-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"]
      : ["-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "192k"];
    const exitCode = await ffmpeg.exec([...common, ...options, outputName]);
    if (exitCode !== 0) throw new Error(kind === "audio" ? "No audio track was available in this range." : "Unable to create this video clip.");
    const bytes = await ffmpeg.readFile(outputName);
    await ffmpeg.deleteFile(outputName);
    const number = kind === "video" ? state.videoNumber++ : state.audioNumber++;
    const name = numberedName(kind, number, extension);
    downloadBlob(new Blob([bytes], { type: kind === "video" ? "video/mp4" : "audio/mp4" }), name);
    elements.mediaStatus.textContent = `${name} ready.`;
  } catch (error) {
    elements.mediaStatus.textContent = error?.message || `Unable to create the ${kind} clip.`;
  } finally {
    state.mediaJob = "";
    elements.videoDownload.disabled = false;
    elements.audioDownload.disabled = false;
    button.textContent = originalLabel;
  }
}

function clearState() {
  elements.video.pause();
  elements.video.removeAttribute("src");
  elements.video.load();
  for (const url of state.urls) URL.revokeObjectURL(url);
  state.urls = [];
  if (state.mediaFfmpeg) state.mediaFfmpeg.terminate();
  state.mediaFfmpeg = null;
  state.mediaInputName = "";
  state.sourceFile = null;
  state.pageBlobs = [];
  state.videoNumber = 1;
  state.audioNumber = 1;
}

async function processRecording() {
  elements.fileError.textContent = "";
  const file = elements.file.files[0];
  if (!file) {
    elements.fileError.textContent = "Choose an MP4 or MOV recording.";
    elements.file.focus();
    return;
  }
  if (file.size > 1024 ** 3) {
    elements.fileError.textContent = "Choose a recording smaller than 1 GB.";
    elements.file.focus();
    return;
  }
  for (const url of state.urls) URL.revokeObjectURL(url);
  state.urls = [];
  state.sourceFile = file;
  state.baseName = cleanBaseName(elements.baseName.value);
  elements.baseName.value = state.baseName;
  elements.baseName.disabled = true;
  elements.process.disabled = true;
  elements.progressSection.hidden = false;
  elements.results.hidden = true;
  report(1, "Checking recording…");
  try {
    const decodeMethod = await prepareVideo(file);
    const result = await stitchRecording(elements.video, elements.canvas, report);
    await buildDownloads(result.canvas);
    const gapText = result.diagnostics.timelineGaps > 0
      ? ` ${result.diagnostics.timelineGaps} unmatched sampled frame${result.diagnostics.timelineGaps === 1 ? "" : "s"} detected.`
      : "";
    elements.summary.textContent = `${state.pageBlobs.length} numbered image${state.pageBlobs.length === 1 ? "" : "s"} created.${gapText}`;
    elements.diagnostics.textContent = JSON.stringify({ ...result.diagnostics, videoDecoding: decodeMethod }, null, 2);
    elements.video.currentTime = 0;
    elements.clipStart.value = "0";
    elements.clipEnd.value = elements.video.duration.toFixed(1);
    elements.clipStart.max = elements.clipEnd.max = elements.video.duration.toFixed(3);
    report(100, "Export ready.");
    elements.results.hidden = false;
    elements.results.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  } catch (error) {
    report(0, "Processing stopped.");
    elements.fileError.textContent = error?.message || "Unable to process this recording.";
    elements.fileError.scrollIntoView({ block: "center" });
    elements.baseName.disabled = false;
  } finally {
    elements.process.disabled = false;
  }
}

elements.file.addEventListener("change", () => {
  const file = elements.file.files[0];
  elements.fileName.textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : "MP4 or MOV, up to 1 GB";
  elements.fileError.textContent = "";
});
elements.process.addEventListener("click", processRecording);
elements.pdf.addEventListener("click", downloadPdf);
elements.setStart.addEventListener("click", () => { elements.clipStart.value = elements.video.currentTime.toFixed(1); });
elements.setEnd.addEventListener("click", () => { elements.clipEnd.value = elements.video.currentTime.toFixed(1); });
elements.videoDownload.addEventListener("click", () => downloadMedia("video"));
elements.audioDownload.addEventListener("click", () => downloadMedia("audio"));
elements.startOver.addEventListener("click", () => {
  clearState();
  elements.file.value = "";
  elements.fileName.textContent = "MP4 or MOV, up to 1 GB";
  elements.baseName.disabled = false;
  elements.results.hidden = true;
  elements.progressSection.hidden = true;
  elements.mediaStatus.textContent = "";
  elements.file.focus();
});
