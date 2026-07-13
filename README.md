# Smart Pointer

Smart Pointer is a mobile-first schematic inspector based on the workflow in `AGENTS.md`.
It captures a camera frame, overlays a high-contrast crosshair, sends a downscaled JPEG
to a local API proxy, and renders a structured diagnostic response as a floating HUD.

## Run

```sh
npm run dev
```

Open `http://localhost:5173`.

## File Guide

| File | Purpose |
| :--- | :--- |
| `package.json` | Project metadata and npm scripts. `dev` runs the local server, `dev:phone` runs HTTPS on the LAN, `phone:url` prints iPhone URLs, and `build` validates the project. |
| `server.js` | Dependency-free Node server. It serves the frontend, exposes `/api/health` and `/api/inspect`, supports optional HTTPS, keeps inspector API keys server-side, and can route inspection to Gemini or local YOLO. |
| `public/index.html` | Main app markup: camera feed, reticle, floating HUD, retry-camera button, domain controls, and inspect button. |
| `public/styles.css` | Mobile-first visual design for the camera surface, HUD, crosshair, retry icon, controls, and responsive layout. |
| `public/app.js` | Browser logic. Starts/retries the camera, moves the crosshair, captures a downscaled JPEG, calls `/api/inspect`, and renders the structured response. |
| `scripts/validate.js` | Lightweight validation script used by `npm run build`. It checks required files, API response fields, static serving, and key client/server behavior. |
| `scripts/phone-url.js` | Finds local IPv4 network addresses and prints `https://...:5173` URLs to open from an iPhone on the same network. |
| `scripts/yolo_inspect.py` | Optional local YOLO detector bridge. The Node server calls it when `INSPECTOR_PROVIDER=yolo`; it uses Ultralytics to return boxes/classes as JSON. |
| `.cert/cert.pem` | Local HTTPS certificate for phone testing. Generated locally; do not commit real cert files unless you intentionally want disposable dev certs in the repo. |
| `.cert/key.pem` | Private key for the local HTTPS certificate. Keep it local and do not share it. |
| `.env` | Optional local environment variables such as inspector API settings. Keep secrets here locally; do not commit real API keys. |

## Run On iPhone Locally

iPhone camera access needs a secure context. For LAN testing, run the app over
HTTPS and open it with your Mac's local network IP address.

1. Find your Mac's Wi-Fi IP address:

   ```sh
   ipconfig getifaddr en0
   ```

2. Create a local certificate. Replace `YOUR_MAC_IP` with the IP from step 1:

   ```sh
   mkdir -p .cert
   openssl req -x509 -newkey rsa:2048 -nodes \
     -keyout .cert/key.pem \
     -out .cert/cert.pem \
     -days 365 \
     -subj "/CN=Smart Pointer Local" \
     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:YOUR_MAC_IP"
   ```

3. Start the phone-accessible HTTPS server:

   ```sh
   npm run dev:phone
   ```

4. Print the URL to open on your iPhone:

   ```sh
   npm run phone:url
   ```

5. On the iPhone, open the printed `https://...:5173` URL.

If Safari warns about the certificate, accept it for local testing. For the
smoothest setup, use `mkcert` and install its local CA profile on the iPhone so
iOS fully trusts the certificate.

## Current Behavior

- Live camera preview with environment-camera preference.
- Tap-to-target crosshair positioning.
- Client-side JPEG downscaling with the crosshair burned into the payload.
- `/api/inspect` proxy endpoint with strict JSON response fields.
- Domain modes for General, Electronics, and Mechanics.
- Safe local fallback response when no real multimodal API key is configured.

## Local YOLO Option

You can run inspection without a Gemini API key by switching the inspector
provider to local YOLO. The browser and `/api/inspect` endpoint stay the same;
the Node server saves the captured frame temporarily, calls
`scripts/yolo_inspect.py`, and maps the closest detection to the HUD response.

Install the local Python dependency:

```sh
python3 -m pip install ultralytics
```

Run locally with YOLO:

```sh
npm run dev:yolo
```

Run on iPhone with HTTPS and YOLO:

```sh
npm run dev:phone:yolo
```

Optional `.env` settings:

```sh
INSPECTOR_PROVIDER=yolo
YOLO_PYTHON=python3
YOLO_MODEL=yolov8n.pt
YOLO_CONFIDENCE=0.25
```

`yolov8n.pt` is a small general-purpose model, so it detects common objects
rather than electronics-specific parts. For useful schematic inspection, use a
YOLO model trained on your target classes, such as connectors, resistors,
capacitors, ICs, screws, gears, belts, or housings.

## API Shape

`POST /api/inspect`

```json
{
  "image": "data:image/jpeg;base64,...",
  "domain": "electronics",
  "target": { "x": 0.5, "y": 0.5 }
}
```

Response:

```json
{
  "component": "Point of interest under crosshair",
  "function": "Primary role in the visible system.",
  "check": "One actionable verification step.",
  "confidence": "low",
  "summary": "Short HUD-ready status line."
}
```
