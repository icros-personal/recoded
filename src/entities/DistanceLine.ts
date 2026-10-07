import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { Hub } from "./Hub";

export class DistanceLine {
  public readonly group: THREE.Group = new THREE.Group();

  private mainLine: Line2;
  private mainGeometry: LineGeometry;
  private mainMaterial: LineMaterial;

  private startDropper: THREE.Line;
  private endDropper: THREE.Line;

  private labelDiv: HTMLDivElement;
  private container: HTMLElement;

  private onResize: () => void;

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Thicker Main Line using Line2
    this.mainGeometry = new LineGeometry();
    this.mainMaterial = new LineMaterial({
      color: 0x3b82f6,
      linewidth: 5, // Width in screen pixels
      transparent: true,
      opacity: 0.9,
    });
    this.mainLine = new Line2(this.mainGeometry, this.mainMaterial);
    this.group.add(this.mainLine);

    // 2. Dashed Vertical Dropper Lines
    const dashMaterial = new THREE.LineDashedMaterial({
      color: 0x60a5fa,
      dashSize: 0.15,
      gapSize: 0.1,
      transparent: true,
      opacity: 0.6,
    });

    this.startDropper = new THREE.Line(new THREE.BufferGeometry(), dashMaterial);
    this.endDropper = new THREE.Line(new THREE.BufferGeometry(), dashMaterial);
    this.group.add(this.startDropper, this.endDropper);

    // 3. HTML Overlay Label
    this.labelDiv = document.createElement("div");
    Object.assign(this.labelDiv.style, {
      position: "absolute",
      transform: "translate(-50%, -100%)", // Centered horizontally, sitting above midpoint
      padding: "4px 10px",
      background: "rgba(15, 23, 42, 0.85)",
      color: "#60a5fa",
      border: "1px solid #3b82f6",
      borderRadius: "10px",
      fontFamily: "monospace",
      fontSize: "13px",
      fontWeight: "bold",
      pointerEvents: "none",
      userSelect: "none",
      boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      backdropFilter: "blur(4px)",
      whiteSpace: "nowrap",
      transition: "opacity 0.15s ease",
      zIndex: "100",
    });

    // Ensure container has relative positioning so absolute child positions correctly
    if (getComputedStyle(this.container).position === "static") {
      this.container.style.position = "relative";
    }

    this.container.appendChild(this.labelDiv);

    this.onResize = () => {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;
        this.mainMaterial.resolution.set(width, height);
    };

    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  update(
    start: THREE.Vector3,
    end: THREE.Vector3,
    camera: THREE.Camera,
    elevationY = Hub.HEIGHT + 1,
  ) {
    // Endpoints elevated to desired height
    const elevatedStart = new THREE.Vector3(start.x, elevationY, start.z);
    const elevatedEnd = new THREE.Vector3(end.x, elevationY, end.z);

    // Update Main Line (Line2 requires flat array of positions)
    this.mainGeometry.setPositions([
      elevatedStart.x, elevatedStart.y, elevatedStart.z,
      elevatedEnd.x, elevatedEnd.y, elevatedEnd.z,
    ]);
    this.mainLine.computeLineDistances();

    // Update Vertical Dropper Lines down to Floor (y = 0)
    const pStartGround = new THREE.Vector3(start.x, 0, start.z);
    const pEndGround = new THREE.Vector3(end.x, 0, end.z);

    this.startDropper.geometry.setFromPoints([elevatedStart, pStartGround]);
    this.startDropper.computeLineDistances();

    this.endDropper.geometry.setFromPoints([elevatedEnd, pEndGround]);
    this.endDropper.computeLineDistances();

    // Distance Calculation & Label Text
    const distance = Math.hypot(end.x - start.x, end.z - start.z);
    this.labelDiv.innerText = `${distance.toFixed(2)} m`;

    // Midpoint Projection for Screen Space Label
    const midPoint = new THREE.Vector3()
      .addVectors(elevatedStart, elevatedEnd)
      .multiplyScalar(0.5);
    midPoint.y += 0.15; // Small offset above the main line

    const proj = midPoint.clone().project(camera);

    // Behind camera check
    if (proj.z > 1) {
      this.labelDiv.style.opacity = "0";
      return;
    }

    // Accurate screen mapping relative to the UI container
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    const x = ((proj.x + 1) * width) / 2;
    const y = ((-proj.y + 1) * height) / 2;

    this.labelDiv.style.opacity = "1";
    this.labelDiv.style.left = `${x}px`;
    this.labelDiv.style.top = `${y}px`;
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);

    this.mainGeometry.dispose();
    this.mainMaterial.dispose();
    this.startDropper.geometry.dispose();
    (this.startDropper.material as THREE.Material).dispose();
    this.endDropper.geometry.dispose();
    (this.endDropper.material as THREE.Material).dispose();
    if (this.labelDiv.parentElement) {
      this.labelDiv.parentElement.removeChild(this.labelDiv);
    }
  }
}