import { stitchRecording } from "./stitcher.js";

const elements = {
  file: document.querySelector("#recording"),
  fileName: document.querySelector("#file-name"),
  fileError: document.querySelector("#file-error"),
  process: document.querySelector("#process"),
  progressSection: document.querySelector("#progress-section"),
  progress: document.querySelector("#progress"),
  status: document.querySelector("#status"),
  results: document.querySelector("#results"),
  summary: document.querySelector("#result-summary"),
  preview: document.querySelector("#preview"),
  continuous: document.querySelector("#continuous-download"),
  pdf: document.querySelector("#pdf-download"),
  pages: document.querySelector("#page-downloads"),
  diagnostics: document.querySelector("#diagnostics"),
  startOver: document.querySelector("#start-over"),
  video: document.querySelector("#video"),
  canvas: document.querySelector("#work-canvas"),
};

const state = { urls: [], pageBlobs: [], resultCanvas: null, baseName: "conversation" };

function report(percent, message) {
  elements.progress.value = percent;
  elements.progress.textContent = String(Math.round(percent));
  elements.status.textContent = message;
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

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
  report(3, "This browser needs the included iPhone video converter. Loading it now…");
  const [{ FFmpeg }, { fetchFile }] = await Promise.all([
    import("./vendor/ffmpeg/index.js"),
    import("./vendor/ffmpeg-util/index.js"),
  ]);
  const ffmpeg = new FFmpeg();
  ffmpeg.on("progress", ({ progress }) => report(3 + Math.max(0, Math.min(1, progress)) * 22, `Converting the iPhone video… ${Math.round(progress * 100)}%`));
  await ffmpeg.load({
    coreURL: new URL("./vendor/ffmpeg-core/ffmpeg-core.js", import.meta.url).href,
    wasmURL: new URL("./vendor/ffmpeg-core/ffmpeg-core.wasm", import.meta.url).href,
  });
  const inputName = file.name.toLowerCase().endsWith(".mov") ? "input.mov" : "input.mp4";
  await ffmpeg.writeFile(inputName, await fetchFile(file));
  // The stitcher samples still frames, so retaining a 60-fps screen recording only makes
  // the browser fallback several times slower without improving the export.
  const exitCode = await ffmpeg.exec(["-i", inputName, "-an", "-vf", "fps=12", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "converted.mp4"]);
  if (exitCode !== 0) {
    ffmpeg.terminate();
    throw new Error("Unable to convert this recording. Try exporting the screen recording as H.264 and process it again.");
  }
  const bytes = await ffmpeg.readFile("converted.mp4");
  ffmpeg.terminate();
  return new Blob([bytes.buffer], { type: "video/mp4" });
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
  report(99, "Creating downloadable files…");
  const continuousBlob = await canvasBlob(canvas, "image/jpeg", 0.92);
  const continuousUrl = URL.createObjectURL(continuousBlob);
  state.urls.push(continuousUrl);
  elements.continuous.href = continuousUrl;
  elements.continuous.download = `${state.baseName}-continuous.jpg`;
  elements.preview.src = continuousUrl;

  const pageHeight = 2400;
  state.pageBlobs = [];
  elements.pages.replaceChildren();
  for (let start = 0, number = 1; start < canvas.height; start += pageHeight, number += 1) {
    const page = document.createElement("canvas");
    page.width = canvas.width;
    page.height = Math.min(pageHeight, canvas.height - start);
    page.getContext("2d", { alpha: false }).drawImage(canvas, 0, start, canvas.width, page.height, 0, 0, canvas.width, page.height);
    const blob = await canvasBlob(page, "image/png");
    state.pageBlobs.push(blob);
    const url = URL.createObjectURL(blob);
    state.urls.push(url);
    const link = document.createElement("a");
    link.className = "page-link";
    link.href = url;
    link.download = `${state.baseName}-${String(number).padStart(4, "0")}.png`;
    link.textContent = `Image ${number}`;
    elements.pages.append(link);
    await nextFrame();
  }
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
    pdf.save(`${state.baseName}.pdf`);
  } catch (error) {
    elements.fileError.textContent = `Unable to create the PDF. ${error.message || "Try downloading the numbered images instead."}`;
  } finally {
    elements.pdf.disabled = false;
    elements.pdf.textContent = originalLabel;
  }
}

function clearUrls() {
  for (const url of state.urls) URL.revokeObjectURL(url);
  state.urls = [];
}

async function processRecording() {
  elements.fileError.textContent = "";
  const file = elements.file.files[0];
  if (!file) {
    elements.fileError.textContent = "Choose an MP4 or MOV screen recording first.";
    elements.file.focus();
    return;
  }
  if (file.size > 1024 ** 3) {
    elements.fileError.textContent = "Choose a recording smaller than 1 GB.";
    elements.file.focus();
    return;
  }
  clearUrls();
  elements.process.disabled = true;
  elements.progressSection.hidden = false;
  elements.results.hidden = true;
  state.baseName = file.name.replace(/\.[^.]+$/, "") || "conversation";
  report(1, "Checking the recording…");
  try {
    const decodeMethod = await prepareVideo(file);
    const result = await stitchRecording(elements.video, elements.canvas, report);
    state.resultCanvas = result.canvas;
    await buildDownloads(result.canvas);
    const connectedWarning = result.diagnostics.timelineGaps > 0
      ? ` ${result.diagnostics.timelineGaps} sampled frame${result.diagnostics.timelineGaps === 1 ? "" : "s"} inside the conversation could not be connected; review the export for a possible gap.`
      : "";
    elements.summary.textContent = `${state.pageBlobs.length} numbered image${state.pageBlobs.length === 1 ? "" : "s"} created.${connectedWarning}`;
    elements.diagnostics.textContent = JSON.stringify({ ...result.diagnostics, videoDecoding: decodeMethod }, null, 2);
    report(100, "Export ready.");
    elements.results.hidden = false;
    elements.results.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  } catch (error) {
    report(0, "Processing stopped.");
    elements.fileError.textContent = error?.message || "Unable to process this recording. Try a shorter recording with slower scrolling.";
    elements.fileError.scrollIntoView({ block: "center" });
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
elements.startOver.addEventListener("click", () => {
  clearUrls();
  elements.file.value = "";
  elements.fileName.textContent = "MP4 or MOV, up to 1 GB";
  elements.results.hidden = true;
  elements.progressSection.hidden = true;
  elements.file.focus();
});
