export class RpmGraph {
  public readonly canvas: HTMLCanvasElement;
  private readonly maxRpm: number;
  private readonly maxLogLength: number;
  private rpmLog: number[] = [];
  private isLogging = false;

  constructor(width = 800, height = 300, maxRpm = 5000, maxLogLength = 200) {
    this.maxRpm = maxRpm;
    this.maxLogLength = maxLogLength;
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
  }

  start() {
    this.isLogging = true;
  }

  stop() {
    this.isLogging = false;
  }

  reset() {
    this.rpmLog = [];
    const ctx = this.canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  update(currentRpm: number) {
    if (!this.isLogging) return;

    this.rpmLog.push(currentRpm);
    if (this.rpmLog.length > this.maxLogLength) {
      this.rpmLog.shift();
    }

    this.render();
  }

  private render() {
    const ctx = this.canvas.getContext("2d");
    if (!ctx || this.rpmLog.length <= 1) return;

    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);

    // Draw RPM curve
    ctx.beginPath();
    ctx.moveTo(
      width,
      ((this.maxRpm - this.rpmLog[this.rpmLog.length - 1]!) / this.maxRpm) * height
    );

    for (let i = 1; i < this.rpmLog.length; i++) {
      const logIndex = this.rpmLog.length - 1 - i;
      ctx.lineTo(
        width - i * (width / this.maxLogLength),
        ((this.maxRpm - this.rpmLog[logIndex]!) / this.maxRpm) * height
      );
    }
    ctx.strokeStyle = "blue";
    ctx.stroke();

    // Grid & Axis
    ctx.strokeStyle = "#aaa";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, height);
    ctx.stroke();

    for (let i = 0; i <= this.maxRpm; i += 1000) {
      ctx.beginPath();
      ctx.moveTo(0, (i / this.maxRpm) * height);
      ctx.lineTo(width, (i / this.maxRpm) * height);
      ctx.stroke();
    }

    ctx.fillText(this.maxRpm.toString(), 0, 12);
    ctx.fillText("0", 0, height);
  }
}