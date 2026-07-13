import { networkInterfaces } from "node:os";

const port = process.env.PORT || "5173";
const interfaces = networkInterfaces();
const urls = [];

for (const entries of Object.values(interfaces)) {
  for (const entry of entries || []) {
    if (entry.family === "IPv4" && !entry.internal) {
      urls.push(`https://${entry.address}:${port}`);
    }
  }
}

if (urls.length === 0) {
  console.log("No LAN IPv4 address found. Check Wi-Fi and run `ipconfig getifaddr en0`.");
  process.exit(1);
}

console.log("Open one of these on your iPhone:");
for (const url of urls) {
  console.log(`- ${url}`);
}
