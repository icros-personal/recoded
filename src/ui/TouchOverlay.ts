export interface TouchOverlayOptions {
  handleIntake?: (isDown: boolean) => void;
  handleShoot?: (isDown: boolean) => void;
}

export class TouchOverlay {
  private touchOverlayEl: HTMLDivElement;
  private joystickThumbEl: HTMLDivElement;
  private joystickCenter = { x: 0, y: 0 };
  private joystickRadius = 50;
  private joystickPointerId: number | null = null;

  private touchInput = {
    forward: 0,
    strafe: 0,
    turnLeft: false,
    turnRight: false,
    shoot: false,
    intake: false,
  };

  constructor(parent: HTMLElement, options: TouchOverlayOptions) {
    this.touchOverlayEl = document.createElement("div");
    this.touchOverlayEl.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      user-select: none;
      z-index: 10;
    `;

    // --- Left Side: Virtual Joystick (Drive) ---
    const joystickBase = document.createElement("div");
    joystickBase.style.cssText = `
      position: absolute;
      left: 30px;
      bottom: 30px;
      width: 120px;
      height: 120px;
      background: rgba(255, 255, 255, 0.15);
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      pointer-events: auto;
      touch-action: none;
    `;

    this.joystickThumbEl = document.createElement("div");
    this.joystickThumbEl.style.cssText = `
      position: absolute;
      left: 35px;
      top: 35px;
      width: 50px;
      height: 50px;
      background: rgba(255, 255, 255, 0.5);
      border-radius: 50%;
      transform: translate(0px, 0px);
      transition: transform 0.05s linear;
    `;
    joystickBase.appendChild(this.joystickThumbEl);
    this.touchOverlayEl.appendChild(joystickBase);

    // Joystick event handlers (Pointer events support both touch and mouse drag)
    joystickBase.addEventListener("pointerdown", (e) => {
      this.joystickPointerId = e.pointerId;
      const rect = joystickBase.getBoundingClientRect();
      this.joystickCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      joystickBase.setPointerCapture(e.pointerId);
      this.updateJoystick(e.clientX, e.clientY);
    });

    joystickBase.addEventListener("pointermove", (e) => {
      if (this.joystickPointerId === e.pointerId) {
        this.updateJoystick(e.clientX, e.clientY);
      }
    });

    const endJoystick = (e: PointerEvent) => {
      if (this.joystickPointerId === e.pointerId) {
        this.joystickPointerId = null;
        this.touchInput.forward = 0;
        this.touchInput.strafe = 0;
        this.joystickThumbEl.style.transform = `translate(0px, 0px)`;
      }
    };
    joystickBase.addEventListener("pointerup", endJoystick);
    joystickBase.addEventListener("pointercancel", endJoystick);

    // --- Right Side: Button Deck ---
    // Layout: [Turn Left] [Shoot] [Turn Right]  + [Intake] above or below
    const buttonDeck = document.createElement("div");
    buttonDeck.style.cssText = `
      position: absolute;
      right: 30px;
      bottom: 30px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: auto;
    `;

    const rowTop = document.createElement("div");
    rowTop.style.cssText = `display: flex; justify-content: center;`;

    if (options.handleIntake) {
      const intakeBtn = this.createTouchButton("📥 Intake", (isDown) => {
        this.touchInput.intake = isDown;
        options.handleIntake?.(isDown);
      });
      rowTop.appendChild(intakeBtn);
    }
    buttonDeck.appendChild(rowTop);

    const rowMain = document.createElement("div");
    rowMain.style.cssText = `display: flex; gap: 10px;`;

    const turnLeftBtn = this.createTouchButton("↺ Turn", (isDown) => {
      this.touchInput.turnLeft = isDown;
    });
    const shootBtn = this.createTouchButton("🔥 Shoot", (isDown) => {
      this.touchInput.shoot = isDown;
      options.handleShoot?.(isDown);
    });
    const turnRightBtn = this.createTouchButton("↻ Turn", (isDown) => {
      this.touchInput.turnRight = isDown;
    });

    rowMain.appendChild(turnLeftBtn);
    if (options.handleShoot) {
      rowMain.appendChild(shootBtn);
    }
    rowMain.appendChild(turnRightBtn);
    buttonDeck.appendChild(rowMain);

    this.touchOverlayEl.appendChild(buttonDeck);
    parent.appendChild(this.touchOverlayEl);
  }

  get state() {
    return this.touchInput;
  }

  private createTouchButton(
    label: string,
    callback?: (isDown: boolean) => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText = `
      width: 75px;
      height: 60px;
      background: rgba(30, 41, 59, 0.8);
      color: white;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 12px;
      font-weight: bold;
      font-size: 13px;
      cursor: pointer;
      touch-action: manipulation;
      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    `;

    const trigger = (isDown: boolean, e: Event) => {
      e.preventDefault();
      btn.style.background = isDown
        ? "rgba(59, 130, 246, 0.9)"
        : "rgba(30, 41, 59, 0.8)";
      callback?.(isDown);
    };

    btn.addEventListener("pointerdown", (e) => trigger(true, e));
    btn.addEventListener("pointerup", (e) => trigger(false, e));
    btn.addEventListener("pointercancel", (e) => trigger(false, e));
    btn.addEventListener("pointerleave", (e) => trigger(false, e));

    return btn;
  }

  private updateJoystick(clientX: number, clientY: number) {
    let dx = clientX - this.joystickCenter.x;
    let dy = clientY - this.joystickCenter.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > this.joystickRadius) {
      dx = (dx / distance) * this.joystickRadius;
      dy = (dy / distance) * this.joystickRadius;
    }

    this.joystickThumbEl.style.transform = `translate(${dx}px, ${dy}px)`;

    // Normalize inputs (-1 to 1). Inverted Y because screen Y is down, robot forward is +Z.
    this.touchInput.forward = -dy / this.joystickRadius;
    this.touchInput.strafe = dx / this.joystickRadius;
  }

  dispose() {
    this.touchOverlayEl.remove();
  }
}
