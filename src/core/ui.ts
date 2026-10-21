import { SettingsModal } from "../ui/SettingsModal";

/** Describes one numeric input a level wants to show in the control bar. */
export interface ControlSpec {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
}

/** Text content a level provides for the page chrome. */
export interface LevelInfo {
  index: number;
  subtitle: string;
  /** Shown in the status line whenever the level is idle/ready. */
  instructions: string;
  /** Overlay label in the viewport. Omit to hide it. */
  targetLabel?: string;
  modal?: {
    title: string;
    body: string;
  };
}

export type StatusKind = 'info' | 'success' | 'miss';

/**
 * Owns the static page shell (header, viewport, control bar) and exposes
 * small methods that levels use to customize it. Levels never touch the DOM
 * directly.
 */
export class GameUI {
  readonly viewport: HTMLDivElement;

  private readonly subtitleEl: HTMLDivElement;
  private readonly targetLabelEl: HTMLDivElement;
  private readonly levelEl: HTMLElement;
  private readonly controlsEl: HTMLElement;
  private readonly actionButton: HTMLButtonElement;
  private readonly statusEl: HTMLDivElement;
  private modalEl: HTMLDivElement | null = null;

  private readonly inputs = new Map<string, HTMLInputElement>();
  private actionHandler: (() => void) | null = null;
  private settingsHandler: (() => void) | null = null;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <main class="game">
        <header>
          <div><h1>FRC Recoded</h1><div class="subtitle"></div></div>
          <button id="settings" type="button">Settings</button>
        </header>
        <div id="viewport" class="viewport" aria-label="Robot simulation"><div class="target-label"></div></div>
        <section class="level"></section>
        <section class="controls">
          <button id="fire" type="button"></button>
          <div id="status" class="status" aria-live="polite"></div>
        </section>
      </main>`;

    this.viewport = root.querySelector<HTMLDivElement>('#viewport')!;
    this.subtitleEl = root.querySelector<HTMLDivElement>('.subtitle')!;
    this.targetLabelEl = root.querySelector<HTMLDivElement>('.target-label')!;
    this.levelEl = root.querySelector<HTMLElement>('.level')!;
    this.controlsEl = root.querySelector<HTMLElement>('.controls')!;
    this.actionButton = root.querySelector<HTMLButtonElement>('#fire')!;
    this.statusEl = root.querySelector<HTMLDivElement>('#status')!;

    this.actionButton.addEventListener('click', () => this.actionHandler?.());
    root.querySelector<HTMLButtonElement>('#settings')?.addEventListener('click', () => this.settingsHandler?.());
  }

  /** Swap the header text, overlay label and control inputs for a new level. */
  showLevel(info: LevelInfo, controls: ControlSpec[]) {
    this.subtitleEl.textContent = `Level ${info.index}: ${info.subtitle}`;
    this.targetLabelEl.textContent = info.targetLabel ?? '';
    this.targetLabelEl.style.display = info.targetLabel ? '' : 'none';
    this.setControls(controls);
    this.setStatus(info.instructions);

    if (info.modal) {
      this.showModal(info.modal.title, info.modal.body);
    }
  }

  showModal(title: string, bodyText: string) {
    if (this.modalEl) {
      this.modalEl.remove();
    }

    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop';
    this.modalEl.innerHTML = `
    <div class="modal-dialog">
      <h2>${title}</h2>
      <p>${bodyText}</p>
      <button type="button" class="modal-ok">OK, Let's Go</button>
    </div>
    `;

    const okButton = this.modalEl.querySelector('.modal-ok') as HTMLButtonElement;
    okButton.addEventListener('click', () => {
      this.modalEl?.remove();
      this.modalEl = null;
    })

    this.viewport.append(this.modalEl);
  }

  setControls(controls: ControlSpec[]) {
    for (const el of this.controlsEl.querySelectorAll('.control')) el.remove();
    this.inputs.clear();

    for (const spec of controls) {
      const wrapper = document.createElement('div');
      wrapper.className = 'control';

      const label = document.createElement('label');
      label.htmlFor = spec.id;
      label.textContent = spec.label;

      // Create the range slider for mobile/easy dragging
      const rangeInput = document.createElement('input');
      rangeInput.type = 'range';
      if (spec.min !== undefined) rangeInput.min = String(spec.min);
      if (spec.max !== undefined) rangeInput.max = String(spec.max);
      if (spec.step !== undefined) rangeInput.step = String(spec.step);
      rangeInput.value = String(spec.value);
      rangeInput.className = 'control-slider';

      // Create the precise number input
      const numberInput = document.createElement('input');
      numberInput.id = spec.id;
      numberInput.type = 'number';
      if (spec.min !== undefined) numberInput.min = String(spec.min);
      if (spec.max !== undefined) numberInput.max = String(spec.max);
      if (spec.step !== undefined) numberInput.step = String(spec.step);
      numberInput.value = String(spec.value);
      numberInput.className = 'control-number';

      // Sync slider -> number input live
      rangeInput.addEventListener('input', () => {
        numberInput.value = rangeInput.value;
      });

      // Sync number input -> slider live
      numberInput.addEventListener('input', () => {
        const val = Number(numberInput.value);
        if (Number.isFinite(val)) {
          rangeInput.value = numberInput.value;
        }
      });

      wrapper.append(label, rangeInput, numberInput);
      
      // Keep the inputs to the left of the action button.
      this.controlsEl.insertBefore(wrapper, this.actionButton);
      
      // Register the number input so getNumber(id) still works transparently
      this.inputs.set(spec.id, numberInput);
    }
  }

  /** Current value of a control, clamped to its min/max. NaN if empty/invalid. */
  getNumber(id: string): number {
    const input = this.inputs.get(id);
    if (!input) return NaN;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return NaN;
    const min = input.min === '' ? -Infinity : Number(input.min);
    const max = input.max === '' ? Infinity : Number(input.max);
    return Math.min(max, Math.max(min, value));
  }

  getControlsContainer(): HTMLElement {
    return this.controlsEl;
  }

  getLevelContainer(): HTMLElement {
    return this.levelEl;
  }

  clearLevelContainer() {
    this.levelEl.replaceChildren();
  }

  setStatus(text: string, kind: StatusKind = 'info') {
    this.statusEl.textContent = text;
    this.statusEl.className = kind === 'info' ? 'status' : `status ${kind}`;
  }

  setAction(label: string, enabled = true) {
    this.actionButton.textContent = label;
    this.actionButton.disabled = !enabled;
  }

  onAction(handler: (() => void) | null) {
    this.actionHandler = handler;
  }

  onSettings(handler: (() => void) | null) {
    this.settingsHandler = handler;
  }
}
