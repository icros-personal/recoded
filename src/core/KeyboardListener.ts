export class KeyboardListener {
  private keysHeld = new Set<string>();
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;

  constructor(private onKeyChange?: (e: KeyboardEvent, isDown: boolean) => void) {
    this.boundKeyDown = (e: KeyboardEvent) => {
        this.keysHeld.add(e.key.toLowerCase());
        this.onKeyChange?.(e, true);
    };
    this.boundKeyUp = (e: KeyboardEvent) => {
        this.keysHeld.delete(e.key.toLowerCase());
        this.onKeyChange?.(e, false);
    };
    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("keyup", this.boundKeyUp);
  }

  isDown(key: string): boolean {
    return this.keysHeld.has(key.toLowerCase());
  }

  dispose() {
    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("keyup", this.boundKeyUp);
    this.keysHeld.clear();
  }
}
