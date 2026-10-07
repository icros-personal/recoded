export class ScoreOverlay {
  private container: HTMLDivElement;
  private scoreText: HTMLDivElement;
  private subtitleText: HTMLDivElement;

  constructor(parentContainer: HTMLElement) {
    this.container = document.createElement("div");
    Object.assign(this.container.style, {
      position: "absolute",
      top: "20px",
      left: "20px",
      zIndex: "50",
      pointerEvents: "none", // Allows clicks through to canvas if needed
      userSelect: "none",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      fontFamily: "system-ui, -apple-system, sans-serif",
    });

    // Main Large Score Display
    this.scoreText = document.createElement("div");
    Object.assign(this.scoreText.style, {
      fontSize: "32px",
      fontWeight: "800",
      color: "#ffffff",
      textShadow: "0 2px 8px rgba(0,0,0,0.7), 0 0 12px rgba(59, 130, 246, 0.5)",
      letterSpacing: "0.5px",
      lineHeight: "1",
    });

    // Optional Subtitle/Progress
    this.subtitleText = document.createElement("div");
    Object.assign(this.subtitleText.style, {
      fontSize: "14px",
      fontWeight: "600",
      color: "#648398",
      textShadow: "0 1px 4px rgba(0,0,0,0.8)",
      textTransform: "uppercase",
      letterSpacing: "1px",
    });

    this.container.appendChild(this.scoreText);
    this.container.appendChild(this.subtitleText);

    // Ensure parent container supports absolute children
    if (getComputedStyle(parentContainer).position === "static") {
      parentContainer.style.position = "relative";
    }

    parentContainer.appendChild(this.container);
  }

  setScore(successful: number, total: number) {
    this.scoreText.innerText = `${successful} / ${total}`;
    this.subtitleText.innerText = "Shots on Target";
  }

  setStatusText(text: string) {
    this.subtitleText.innerText = text;
  }

  dispose() {
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}