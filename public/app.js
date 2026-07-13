const video = document.querySelector("#camera");
const canvas = document.querySelector("#captureCanvas");
const reticle = document.querySelector("#reticle");
const pin = document.querySelector("#targetPin");
const statusText = document.querySelector("#statusText");
const cameraButton = document.querySelector("#cameraButton");
const inspectButton = document.querySelector("#inspectButton");
const hudCard = document.querySelector("#hudCard");
const hudToggle = document.querySelector("#hudToggle");
const componentName = document.querySelector("#componentName");
const componentFunction = document.querySelector("#componentFunction");
const componentCheck = document.querySelector("#componentCheck");
const confidenceBadge = document.querySelector("#confidenceBadge");
const latencyReadout = document.querySelector("#latencyReadout");

let stream = null;
let target = { x: 0.5, y: 0.5 };
let inspecting = false;
let hudCollapsed = false;
let cameraReady = false;

function setStatus(message) {
  statusText.textContent = message;
}

function getDomain() {
  const selected = document.querySelector("input[name='domain']:checked");
  return selected ? selected.value : "general";
}

function isCameraFrameReady() {
  return cameraReady && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0;
}

function setInspectEnabled(enabled) {
  inspectButton.disabled = !enabled || inspecting;
}

function markCameraReady() {
  cameraReady = true;
  setInspectEnabled(true);
  setStatus("Camera ready. Aim the crosshair and tap inspect.");
}

function positionTarget(clientX, clientY) {
  const bounds = video.getBoundingClientRect();
  const x = Math.min(Math.max((clientX - bounds.left) / bounds.width, 0), 1);
  const y = Math.min(Math.max((clientY - bounds.top) / bounds.height, 0), 1);
  target = { x, y };

  reticle.style.left = `${x * 100}%`;
  reticle.style.top = `${y * 100}%`;
  pin.style.left = `${x * 100}%`;
  pin.style.top = `${y * 100}%`;
  pin.classList.add("is-visible");
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera API is unavailable in this browser.");
    setInspectEnabled(false);
    return;
  }

  try {
    cameraReady = false;
    setInspectEnabled(false);
    setStatus("Requesting camera access...");
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();
    if (video.videoWidth && video.videoHeight) {
      markCameraReady();
    } else {
      setStatus("Camera opened. Waiting for first video frame...");
    }
  } catch (error) {
    cameraReady = false;
    setInspectEnabled(false);
    setStatus("Camera blocked. Allow camera access or use localhost.");
    console.error(error);
  }
}

function drawReticleOnCanvas(context, width, height) {
  const cx = target.x * width;
  const cy = target.y * height;

  context.save();
  context.strokeStyle = "#47ff8f";
  context.fillStyle = "#47ff8f";
  context.lineWidth = Math.max(3, width * 0.004);
  context.shadowColor = "rgba(71, 255, 143, 0.85)";
  context.shadowBlur = 14;
  context.beginPath();
  context.arc(cx, cy, width * 0.038, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(cx - width * 0.065, cy);
  context.lineTo(cx + width * 0.065, cy);
  context.moveTo(cx, cy - width * 0.065);
  context.lineTo(cx, cy + width * 0.065);
  context.stroke();
  context.beginPath();
  context.arc(cx, cy, width * 0.006, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function captureFrame() {
  if (!isCameraFrameReady()) {
    throw new Error("Camera frame is not ready yet. Wait until the live preview appears, then tap Inspect Target again.");
  }

  const maxWidth = 960;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(video, 0, 0, width, height);
  drawReticleOnCanvas(context, width, height);

  return canvas.toDataURL("image/jpeg", 0.76);
}

function renderInspection(result, elapsedMs) {
  componentName.textContent = result.component || "Unknown component";
  componentFunction.textContent = result.function || "No function returned.";
  componentCheck.textContent = result.check || "No check returned.";
  confidenceBadge.textContent = `Confidence: ${result.confidence || "unknown"}`;
  latencyReadout.textContent = `${elapsedMs} ms`;

  setStatus(result.summary || "Inspection complete.");
}

function getErrorAdvice(message) {
  if (message.includes("Camera frame is not ready")) {
    return {
      functionText: "The browser has camera permission, but Safari has not delivered a usable video frame yet.",
      checkText: "Wait for the live preview to move, then press Inspect Target. If it stays frozen, tap the retry icon."
    };
  }

  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return {
      functionText: "The phone could not reach the local Node proxy at /api/inspect.",
      checkText: "Confirm npm run dev:phone is still running on the Mac and reopen the HTTPS URL from npm run phone:url."
    };
  }

  return {
    functionText: message,
    checkText: "Retry once. If it repeats, run npm run check:api on the Mac and check the server terminal for the exact inspector error."
  };
}

function renderInspectionError(error) {
  const message = error instanceof Error ? error.message : "Inspection failed.";
  const advice = getErrorAdvice(message);

  setStatus(message);
  componentName.textContent = "Inspection unavailable";
  componentFunction.textContent = advice.functionText;
  componentCheck.textContent = advice.checkText;
  confidenceBadge.textContent = "Error";
  latencyReadout.textContent = "Retry";
}

function setHudCollapsed(nextCollapsed) {
  hudCollapsed = nextCollapsed;
  hudCard.classList.toggle("is-collapsed", hudCollapsed);
  hudToggle.setAttribute("aria-expanded", String(!hudCollapsed));
  hudToggle.setAttribute("aria-label", hudCollapsed ? "Expand inspector panel" : "Collapse inspector panel");
  hudToggle.setAttribute("title", hudCollapsed ? "Expand inspector panel" : "Collapse inspector panel");
}

async function inspectTarget() {
  if (inspecting) {
    return;
  }

  inspecting = true;
  inspectButton.disabled = true;
  setStatus("Capturing frame and sending to inspector...");

  const started = performance.now();

  try {
    const image = captureFrame();
    const response = await fetch("/api/inspect", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        image,
        domain: getDomain(),
        target
      })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Inspection failed.");
    }

    renderInspection(result, Math.round(performance.now() - started));
  } catch (error) {
    renderInspectionError(error);
    console.error(error);
  } finally {
    inspecting = false;
    setInspectEnabled(isCameraFrameReady());
  }
}

video.addEventListener("loadedmetadata", markCameraReady);
video.addEventListener("canplay", markCameraReady);

video.addEventListener("pointerdown", (event) => {
  positionTarget(event.clientX, event.clientY);
});

cameraButton.addEventListener("click", startCamera);
inspectButton.addEventListener("click", inspectTarget);
hudToggle.addEventListener("click", () => {
  setHudCollapsed(!hudCollapsed);
});

window.addEventListener("resize", () => {
  reticle.style.left = `${target.x * 100}%`;
  reticle.style.top = `${target.y * 100}%`;
  pin.style.left = `${target.x * 100}%`;
  pin.style.top = `${target.y * 100}%`;
});

startCamera();
