import "./LessonPanel.css";

export interface ButtonSpec {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}

export class LessonPanel {
  private root: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private readoutEl: HTMLPreElement;
  private resultEl: HTMLDivElement;
  private customContentEl: HTMLDivElement;
  private buttonRowEl: HTMLDivElement;

  constructor(private parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "lessonPanel";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "lessonTitle";

    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "lessonBody";

    this.readoutEl = document.createElement("pre");
    this.readoutEl.className = "lessonReadout";

    this.resultEl = document.createElement("div");
    this.resultEl.className = "lessonResult";

    this.customContentEl = document.createElement("div");
    this.customContentEl.className = "lessonCustomContent";

    this.buttonRowEl = document.createElement("div");
    this.buttonRowEl.className = "lessonButtonRow";

    this.root.append(
      this.titleEl,
      this.bodyEl,
      this.readoutEl,
      this.resultEl,
      this.customContentEl,
      this.buttonRowEl,
    );
    parent.appendChild(this.root);
  }

  setTitle(text: string) {
    this.titleEl.textContent = text;
  }

  setBody(html: string) {
    this.bodyEl.innerHTML = html;
  }

  setReadout(text: string, highlight: boolean = false) {
    if (!text) {
      this.readoutEl.style.display = 'none';
    } else {
      this.readoutEl.style.display = 'block';
      this.readoutEl.textContent = text;
      this.readoutEl.style.color = highlight ? "#7dffc0" : "";
    }
  }

  setResult(text: string, visible: boolean = true) {
    this.resultEl.textContent = text;
    this.resultEl.style.display = visible ? "block" : "none";
  }

  setButtons(specs: ButtonSpec[]) {
    const buttons = specs.map((spec) => {
      const b = document.createElement("button");
      b.textContent = spec.label;
      b.tabIndex = -1;
      b.className = "lessonButton";
      b.disabled = !!spec.disabled;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        spec.onClick();
        b.blur();
      });
      return b;
    });
    this.buttonRowEl.replaceChildren(...buttons);
  }

  setCustomContent(element: HTMLElement | null) {
    this.customContentEl.replaceChildren(...(element ? [element] : []));
  }

  scrollToTop() {
    this.root.scrollTop = 0;
  }

  dispose() {
    this.root.remove();
  }
}
