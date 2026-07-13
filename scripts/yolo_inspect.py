#!/usr/bin/env python3
import argparse
import contextlib
import json
import sys


def main():
    parser = argparse.ArgumentParser(description="Run local YOLO detection for Smart Pointer.")
    parser.add_argument("--image", required=True)
    parser.add_argument("--model", default="yolov8n.pt")
    parser.add_argument("--confidence", type=float, default=0.25)
    args = parser.parse_args()

    try:
        with contextlib.redirect_stdout(sys.stderr):
            from ultralytics import YOLO
    except Exception:
        print(json.dumps({
            "error": "Python package 'ultralytics' is not installed. Run: python3 -m pip install ultralytics"
        }))
        return 0

    try:
        with contextlib.redirect_stdout(sys.stderr):
            model = YOLO(args.model)
            results = model.predict(args.image, conf=args.confidence, verbose=False)
        detections = []

        if results:
            result = results[0]
            height, width = result.orig_shape
            names = result.names
            for box in result.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cls = int(box.cls[0].item())
                confidence = float(box.conf[0].item())
                detections.append({
                    "label": names.get(cls, str(cls)) if isinstance(names, dict) else str(cls),
                    "classId": cls,
                    "confidence": confidence,
                    "box": {
                        "x1": x1 / width,
                        "y1": y1 / height,
                        "x2": x2 / width,
                        "y2": y2 / height
                    }
                })

        print(json.dumps({
            "model": args.model,
            "detections": detections
        }))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))


if __name__ == "__main__":
    main()
