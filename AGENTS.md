# Agent Architecture: Smart Pointer Schematic Inspector

This document outlines the agentic workflow, prompt design, and data flow for the Smart Pointer app. The system bridges physical spatial mapping (WebXR) with a Multimodal Vision Agent to provide instant hardware analysis and troubleshooting.

## Instructions for Coding Agents
- Preserve the WebXR -> API proxy -> vision model -> HUD flow.
- Keep model responses strict JSON.
- Prefer low-latency client-side image downscaling before API calls.
- Do not add local object-detection unless explicitly requested.

---

## 1. System Overview

The application utilizes a **Single-Agent Evaluator Model** coupled with a lightweight spatial client. Instead of relying on a locally trained object-detection model, the system delegates visual parsing to a large multimodal model optimized for speed and low-latency reasoning.

### Data Flow Pipeline

| Phase | Source | Action / Payload | Destination |
| :--- | :--- | :--- | :--- |
| **1. Request** | Mobile Client (WebXR/Canvas) | User taps screen; captures raw frame | API Proxy / Edge |
| **2. Transit** | API Proxy / Edge | Scales image, appends system prompt | Multimodal Vision Agent |
| **3. Processing** | Multimodal Vision Agent | Evaluates target under crosshair; builds reply | API Proxy / Edge |
| **4. Delivery** | API Proxy / Edge | Delivers structured JSON string | Mobile Client HUD |

---

## 2. Agent Definitions

### 🛠️ The Inspector Agent
*   **Role:** Expert Hardware, Electronics, and Mechanical Systems Engineer.
*   **Core Objective:** Accurately identify physical components from static video frames, deduce their functional role within the visible system, and synthesize proactive troubleshooting steps.
*   **Model Tier:** `gemini-3.5-flash` (Optimized for sub-2-second latency and high spatial-visual accuracy).

---

## 3. Protocol & Execution Flow

The agent operates on an **On-Demand Execution Loop** triggered explicitly by user interaction:

1. **Spatial Capture (Client-Side)**
   The user taps the mobile screen over a target object. The client anchors a 3D coordinate point in space and captures the current frame from the camera via an HTML5 Canvas.

2. **Contextual Payload Prep (Client-Side)**
   The frame is downscaled and converted to a base64 JPEG. The client appends a global context prompt based on the user's active domain selection (e.g., Electronics, Mechanics, General).

3. **Inference & Extraction (Agent-Side)**
   The Vision Agent processes the image array. It locates the visual target marker (crosshair) added by the interface and executes its classification and reasoning chain.

4. **Structured Delivery (Agent-Side -> Client)**
   The agent returns a strict JSON payload. The client parses this payload and immediately binds the text to the floating 3D spatial entity in the WebXR view.
```text
{
    "component": "string",
    "function": "string",
    "check": "string",
    "confidence": "low | medium | high"
}
```

---

## 4. Prompt Engineering & System Instructions

To ensure deterministic, concise outputs suitable for a floating mobile HUD, the agent is bound by the following strict system instructions.

### System Prompt
```text
You are a highly precise, helpful hardware diagnostic assistant. 
The user is pointing their camera at a physical object and has tapped a component positioned directly underneath the high-contrast green crosshair marker overlayed on the provided image.

Analyze the image and fulfill the following tasks:
1. Identify the exact component or point of interest under the crosshair.
2. Explain its primary function in the context of the visible system.
3. Provide one actionable troubleshooting tip or verification check for this specific component.

Constraints:
- Rely strictly on what is visually verifiable or logically deduced from the context.
- Keep your total response under 3 sentences.
- Be direct; do not use conversational filler (e.g., "Looking at this image...", "Based on what I see...").
- If the component cannot be identified confidently, return the most specific visible category and set confidence to low. Do not invent part numbers, brands, voltages, or hidden connections.
- If no crosshair is visible, analyze the image center. If the crosshair covers multiple components, choose the component closest to the crosshair center.
- Do not instruct users to touch live circuits, bypass safety systems, or disassemble powered equipment. Prefer visual checks, power-off continuity checks, connector seating checks, and documentation lookup.
```

---

## 5. Commit Message Convention
**Structure:** <type>[optional scope]: <description>
- **Type:** Define the nature of the change.
    * feat: Adding a new feature.
    * fix: Resolving a bug.
    * docs: Changes to documentation or README.
    * refactor: Code restructuring without changing behavior.
    * perf: Performance-related improvements.
    * test: Adding or updating tests.
- **Scope (optional):** The specific area of the project affected (api, auth, dashboard, db, frontend, generation, home, render, ui)
- **Summary:** A concise, imperative sentence (e.g., Add support for...). Use the imperative mood (e.g., "Add," not "Added").
- **Example:** "feat: allow provided config object to extend other configs"