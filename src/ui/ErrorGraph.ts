export class ErrorGraph {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private graphSeconds: number;
  private graphRange: number;

  constructor(
    width: number,
    height: number,
    graphSeconds = 4,
    graphRange = Math.PI / 2,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.cssText =
      "background:rgba(0,0,0,.6);width:100%;height:auto;display:block;border-radius:6px;";
    this.ctx = this.canvas.getContext("2d")!;
    this.graphSeconds = graphSeconds;
    this.graphRange = graphRange;
  }

  draw(errorHistory: { t: number; e: number }[], currentTime: number) {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const g = this.ctx;

    g.clearRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,.06)";
    g.fillRect(0, 0, w, h);

    // Zero baseline
    g.strokeStyle = "rgba(255,255,255,.35)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();

    // Error trace
    g.strokeStyle = "#5ee6a8";
    g.lineWidth = 2;
    g.beginPath();
    errorHistory.forEach((s, i) => {
      const x = w - ((currentTime - s.t) / this.graphSeconds) * w;
      const y =
        h / 2 - Math.max(-1, Math.min(1, s.e / this.graphRange)) * (h / 2 - 3);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();

    g.fillStyle = "rgba(255,255,255,.6)";
    g.font = "10px system-ui, sans-serif";
    g.fillText("angle error (±90°) · last 4 s", 6, 12);
  }
}
