import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");

function loadLocalEnv() {
  try {
    const envPath = join(root, ".env");
    const envText = readFileSync(envPath, "utf8");
    for (const line of envText.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1].startsWith("#") || process.env[match[1]] !== undefined) {
        continue;
      }

      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // .env is optional; production/runtime environments can provide vars directly.
  }
}

loadLocalEnv();

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5173);
const httpsKeyPath = process.env.HTTPS_KEY || "";
const httpsCertPath = process.env.HTTPS_CERT || "";
const inspectorProvider = (process.env.INSPECTOR_PROVIDER || "gemini").toLowerCase();
const isMain = process.argv[1] === fileURLToPath(import.meta.url);

const systemPrompt = `You are a highly precise, helpful hardware diagnostic assistant.
The user is pointing their camera at a physical object and has tapped a component positioned directly underneath the high-contrast green crosshair marker overlayed on the provided image.

Analyze the image and fulfill the following tasks:
1. Identify the exact component or point of interest under the crosshair.
2. Explain its primary function in the context of the visible system.
3. Provide one actionable troubleshooting tip or verification check for this specific component.

Constraints:
- Rely strictly on what is visually verifiable or logically deduced from the context.
- Keep your total response under 3 sentences.
- Be direct; do not use conversational filler.
- Return strict JSON with component, function, check, confidence, and summary fields.`;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function getMockInspection(domain, target) {
  const normalizedDomain = String(domain || "general").toLowerCase();
  const normalizedTarget = target && Number.isFinite(target.x) && Number.isFinite(target.y)
    ? target
    : { x: 0.5, y: 0.5 };

  const targetHint = normalizedTarget.y < 0.35
    ? "upper visible assembly"
    : normalizedTarget.y > 0.68
      ? "lower visible assembly"
      : "crosshair target";

  if (normalizedDomain === "electronics") {
    return {
      component: "Highlighted electronic component",
      function: "It is likely part of the visible circuit path and should be checked as a connection, control, or protection point before deeper diagnosis.",
      check: "Power the system off, inspect solder joints and connector seating at the crosshair, then verify continuity with a multimeter if the part is accessible.",
      confidence: "low",
      summary: `Electronics mode flagged the ${targetHint}; connect a Gemini Vision API key to replace this local fallback with visual classification.`
    };
  }

  if (normalizedDomain === "mechanics") {
    return {
      component: "Highlighted mechanical feature",
      function: "It likely acts as a fastener, support, guide, or motion-transfer point within the visible assembly.",
      check: "With the mechanism unpowered, check for looseness, misalignment, rubbing, cracks, or missing retaining hardware at the crosshair.",
      confidence: "low",
      summary: `Mechanics mode flagged the ${targetHint}; connect a Gemini Vision API key to replace this local fallback with visual classification.`
    };
  }

  return {
    component: "Point of interest under crosshair",
    function: "It is the selected part of the visible system and should be interpreted in relation to nearby connectors, supports, traces, or moving elements.",
    check: "Inspect the selected area for damage, loose fit, contamination, heat marks, or alignment issues before handling powered equipment.",
    confidence: "low",
    summary: `General mode captured the ${targetHint}; connect a Gemini Vision API key to replace this local fallback with visual classification.`
  };
}

function getInspectorUnavailableInspection(domain, target, reason) {
  const fallback = getMockInspection(domain, target);
  return {
    ...fallback,
    component: "Inspector API unavailable",
    function: "The camera frame was captured, but the remote vision model did not return a usable response.",
    check: "Try again in a moment, or run npm run check:api on the Mac to verify the configured Gemini endpoint and key.",
    confidence: "low",
    summary: reason || "External inspector unavailable; showing a safe local fallback.",
    source: "fallback"
  };
}

function getComponentRole(component, domain) {
  const name = String(component || "detected object").toLowerCase();
  const normalizedDomain = String(domain || "general").toLowerCase();

  if (normalizedDomain === "electronics") {
    return {
      functionText: `The detected ${name} is a visible point in the electronics assembly; use it as a candidate connector, package, control, or test point.`,
      checkText: `Power the device off, inspect the ${name} for loose seating, heat marks, cracked solder, or damaged nearby traces.`
    };
  }

  if (normalizedDomain === "mechanics") {
    return {
      functionText: `The detected ${name} is part of the visible mechanical assembly and may act as a support, fastener, guide, or interface point.`,
      checkText: `With the mechanism unpowered, check the ${name} for looseness, misalignment, rubbing, cracks, or missing retaining hardware.`
    };
  }

  return {
    functionText: `The detected ${name} is the closest local YOLO match to the crosshair.`,
    checkText: `Inspect the ${name} for visible damage, loose fit, contamination, heat marks, or alignment issues before handling powered equipment.`
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function parseLastJsonLine(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith("{") && !line.startsWith("[")) {
      continue;
    }

    try {
      return JSON.parse(line);
    } catch {
      // Keep scanning in case a library emitted a JSON-looking log line.
    }
  }

  throw new Error(`YOLO script did not return JSON. Output started with: ${stdout.slice(0, 120)}`);
}

function scoreDetectionForTarget(detection, target) {
  const box = detection.box || {};
  const centerX = (Number(box.x1) + Number(box.x2)) / 2;
  const centerY = (Number(box.y1) + Number(box.y2)) / 2;
  const dx = centerX - Number(target.x || 0.5);
  const dy = centerY - Number(target.y || 0.5);
  const distance = Math.hypot(dx, dy);
  const inside = Number(target.x) >= Number(box.x1)
    && Number(target.x) <= Number(box.x2)
    && Number(target.y) >= Number(box.y1)
    && Number(target.y) <= Number(box.y2);

  return (inside ? -1 : 0) + distance - Number(detection.confidence || 0) * 0.05;
}

async function callLocalYoloInspector(payload) {
  const imageData = payload.image.replace(/^data:image\/jpeg;base64,/, "");
  const imageBuffer = Buffer.from(imageData, "base64");
  const imageDir = join(tmpdir(), "smart-pointer");
  const imagePath = join(imageDir, `${randomUUID()}.jpg`);
  const target = payload.target || { x: 0.5, y: 0.5 };

  await mkdir(imageDir, { recursive: true });
  await writeFile(imagePath, imageBuffer);

  try {
    const { stdout } = await runCommand(process.env.YOLO_PYTHON || "python3", [
      "scripts/yolo_inspect.py",
      "--image",
      imagePath,
      "--model",
      process.env.YOLO_MODEL || "yolov8n.pt",
      "--confidence",
      process.env.YOLO_CONFIDENCE || "0.25"
    ]);
    const result = parseLastJsonLine(stdout);

    if (result.error) {
      throw new Error(result.error);
    }

    const detections = Array.isArray(result.detections) ? result.detections : [];
    if (detections.length === 0) {
      return {
        component: "No YOLO detection at crosshair",
        function: "The local detector did not find a known object near the selected point.",
        check: "Move closer, improve lighting, or use a YOLO model trained on the parts you expect to inspect.",
        confidence: "low",
        summary: "Local YOLO ran, but no matching object was detected.",
        source: "yolo"
      };
    }

    const best = detections
      .map((detection) => ({
        ...detection,
        targetScore: scoreDetectionForTarget(detection, target)
      }))
      .sort((a, b) => a.targetScore - b.targetScore)[0];
    const role = getComponentRole(best.label, payload.domain);

    return {
      component: best.label || "Detected object",
      function: role.functionText,
      check: role.checkText,
      confidence: Number(best.confidence || 0) >= 0.7 ? "high" : Number(best.confidence || 0) >= 0.4 ? "medium" : "low",
      summary: `Local YOLO selected ${best.label || "an object"} at ${Math.round(Number(best.confidence || 0) * 100)}% confidence.`,
      source: "yolo",
      detections
    };
  } finally {
    await unlink(imagePath).catch(() => {});
  }
}

async function callExternalInspector(payload) {
  if (inspectorProvider === "yolo") {
    return callLocalYoloInspector(payload);
  }

  if (process.env.SKIP_EXTERNAL_INSPECTOR || !process.env.INSPECTOR_API_URL) {
    return null;
  }

  const endpoint = new URL(process.env.INSPECTOR_API_URL);
  const isGeminiInteractions = endpoint.hostname === "generativelanguage.googleapis.com"
    && endpoint.pathname.endsWith("/interactions");

  if (isGeminiInteractions) {
    const imageData = payload.image.replace(/^data:image\/jpeg;base64,/, "");
    const prompt = [
      `Domain: ${payload.domain || "general"}.`,
      `Crosshair target: ${JSON.stringify(payload.target || { x: 0.5, y: 0.5 })}.`,
      "Return only strict JSON with component, function, check, confidence, and summary fields."
    ].join(" ");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": process.env.INSPECTOR_API_KEY || ""
      },
      body: JSON.stringify({
        model: process.env.INSPECTOR_MODEL || "gemini-3.5-flash",
        system_instruction: systemPrompt,
        input: [
          { type: "text", text: prompt },
          { type: "image", data: imageData, mime_type: "image/jpeg" }
        ],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            properties: {
              component: { type: "string" },
              function: { type: "string" },
              check: { type: "string" },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
              summary: { type: "string" }
            },
            required: ["component", "function", "check", "confidence", "summary"]
          }
        }
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Inspector API returned ${response.status}: ${detail.slice(0, 400)}`);
    }

    const result = await response.json();
    const outputText = result.output_text || "";
    return JSON.parse(outputText.replace(/^```json\s*/i, "").replace(/\s*```$/i, ""));
  }

  const response = await fetch(process.env.INSPECTOR_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.INSPECTOR_API_KEY
        ? { authorization: `Bearer ${process.env.INSPECTOR_API_KEY}` }
        : {})
    },
    body: JSON.stringify({
      prompt: systemPrompt,
      image: payload.image,
      domain: payload.domain || "general",
      target: payload.target || { x: 0.5, y: 0.5 }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Inspector API returned ${response.status}: ${detail.slice(0, 400)}`);
  }

  return response.json();
}

export async function inspectFrame(payload) {
  const hasImage = typeof payload.image === "string" && payload.image.startsWith("data:image/jpeg;base64,");
  if (!hasImage) {
    return {
      error: "image must be a base64 JPEG data URL"
    };
  }

  let externalInspection = null;
  try {
    externalInspection = await callExternalInspector(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`External inspector failed: ${message}`);
    const userReason = inspectorProvider === "yolo"
      ? "Local YOLO failed; showing a safe local fallback."
      : message.includes("high demand")
      ? "Gemini is temporarily busy; showing a safe local fallback."
      : message.includes("too_many_requests") || message.includes("Quota")
        ? "Gemini quota is temporarily exhausted; showing a safe local fallback."
      : "External inspector failed; showing a safe local fallback.";
    return {
      ...getInspectorUnavailableInspection(payload.domain, payload.target, userReason),
      prompt: systemPrompt,
      received: {
        domain: payload.domain || "general",
        target: payload.target || { x: 0.5, y: 0.5 },
        imageBytesApprox: Math.round((payload.image.length * 3) / 4)
      }
    };
  }

  const inspection = externalInspection || getMockInspection(payload.domain, payload.target);

  return {
    ...inspection,
    prompt: systemPrompt,
    received: {
      domain: payload.domain || "general",
      target: payload.target || { x: 0.5, y: 0.5 },
      imageBytesApprox: Math.round((payload.image.length * 3) / 4)
    }
  };
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

function createRequestHandler() {
  return async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && request.url === "/api/inspect") {
      const payload = await readJson(request);
      const result = await inspectFrame(payload);
      if (result.error) {
        sendJson(response, 400, result);
        return;
      }

      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }

    response.writeHead(405, { allow: "GET, POST" });
    response.end("Method not allowed");
  } catch (error) {
    sendJson(response, 500, {
      error: "internal server error",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
  };
}

export function createSmartPointerServer(options = {}) {
  const handler = createRequestHandler();
  if (options.key && options.cert) {
    return createHttpsServer({ key: options.key, cert: options.cert }, handler);
  }

  return createHttpServer(handler);
}

if (isMain) {
  const httpsOptions = httpsKeyPath && httpsCertPath
    ? {
        key: readFileSync(httpsKeyPath),
        cert: readFileSync(httpsCertPath)
      }
    : {};
  const server = createSmartPointerServer(httpsOptions);
  const protocol = httpsOptions.key && httpsOptions.cert ? "https" : "http";

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use on ${host}.`);
      console.error(`Stop the existing dev server or run with another port, for example: PORT=5174 npm run dev`);
      process.exit(1);
    }

    throw error;
  });

  server.listen(port, host, () => {
    console.log(`Smart Pointer running at ${protocol}://${host}:${port}`);
    if (host === "0.0.0.0") {
      console.log("Use your Mac's LAN IP address from the phone, not 0.0.0.0.");
    }
  });
}
