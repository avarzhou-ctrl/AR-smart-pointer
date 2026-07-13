import "../server.js";

const hasUrl = Boolean(process.env.INSPECTOR_API_URL);
const hasKey = Boolean(process.env.INSPECTOR_API_KEY);

console.log(`INSPECTOR_API_URL: ${hasUrl ? "set" : "missing"}`);
console.log(`INSPECTOR_API_KEY: ${hasKey ? "set" : "missing"}`);

if (!hasUrl) {
  console.log("No inspector API URL is configured, so the app will use the local fallback.");
  process.exit(0);
}

try {
  const endpoint = new URL(process.env.INSPECTOR_API_URL);
  const isGeminiInteractions = endpoint.hostname === "generativelanguage.googleapis.com"
    && endpoint.pathname.endsWith("/interactions");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(isGeminiInteractions
        ? { "x-goog-api-key": process.env.INSPECTOR_API_KEY || "" }
        : { authorization: `Bearer ${process.env.INSPECTOR_API_KEY || ""}` })
    },
    body: JSON.stringify(isGeminiInteractions
      ? {
          model: process.env.INSPECTOR_MODEL || "gemini-3.5-flash",
          input: "Reply with the word ok."
        }
      : {
          input: "Reply with the word ok."
        })
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(`Inspector API returned HTTP ${response.status}.`);
    console.error(detail.slice(0, 1200));
    process.exit(1);
  }

  const result = await response.json();
  console.log("Inspector API connection returned a successful response.");
  console.log(`Response id field: ${result.id ? "present" : "missing"}`);
  console.log(`Response text field: ${result.output_text ? "present" : "missing"}`);
} catch (error) {
  console.error(`Inspector API connection failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
