import { access, readFile } from "node:fs/promises";
import { createSmartPointerServer, inspectFrame } from "../server.js";

process.env.SKIP_EXTERNAL_INSPECTOR = "1";

const requiredFiles = [
  "server.js",
  "public/index.html",
  "public/styles.css",
  "public/app.js",
  "scripts/yolo_inspect.py"
];

for (const file of requiredFiles) {
  await access(file);
}

const server = await readFile("server.js", "utf8");
const client = await readFile("public/app.js", "utf8");

const requiredServerSnippets = [
  "/api/inspect",
  "data:image/jpeg;base64,",
  "component",
  "confidence"
];

const requiredClientSnippets = [
  "getUserMedia",
  "toDataURL(\"image/jpeg\"",
  "fetch(\"/api/inspect\"",
  "drawReticleOnCanvas"
];

const missing = [
  ...requiredServerSnippets.filter((snippet) => !server.includes(snippet)),
  ...requiredClientSnippets.filter((snippet) => !client.includes(snippet))
];

if (missing.length > 0) {
  console.error(`Validation failed. Missing: ${missing.join(", ")}`);
  process.exit(1);
}

const apiResult = await inspectFrame({
  image: "data:image/jpeg;base64,aaaa",
  domain: "electronics",
  target: { x: 0.5, y: 0.5 }
});

if (!apiResult.component || !apiResult.function || !apiResult.check || !apiResult.confidence) {
  console.error("Validation failed. Inspection response is missing required fields.");
  process.exit(1);
}

const serverInstance = createSmartPointerServer();
await new Promise((resolve, reject) => {
  serverInstance.once("error", reject);
  serverInstance.listen(0, "127.0.0.1", resolve);
});

const address = serverInstance.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
const html = await fetch(`${baseUrl}/`).then((response) => response.text());

await new Promise((resolve, reject) => {
  serverInstance.close((error) => (error ? reject(error) : resolve()));
});

if (!health.ok || !html.includes("Smart Pointer") || !html.includes("/app.js")) {
  console.error("Validation failed. Local server did not serve expected content.");
  process.exit(1);
}

console.log("Validation passed.");
