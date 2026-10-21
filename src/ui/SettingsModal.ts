import type { Game } from "../core/Game";
import type { Level } from "../levels/Level";

import { Table } from "./Table";

import './Achievements.css';
import "./SettingsModal.css";

export class SettingsModal {
  private root: HTMLDivElement;
  private achievements: HTMLDivElement;
  private dialog: HTMLDivElement;
  private table: Table;
  private tableUnsubscribe: () => void;
  private kPInput: HTMLInputElement;
  private downOnBackdrop = false;

  private distanceDriven: HTMLSpanElement;
  private pathFollowed: HTMLSpanElement;
  private rotations: HTMLSpanElement;
  private shots: HTMLSpanElement;
  private fuel: HTMLSpanElement;

  constructor(private readonly game: Game) {
    this.root = document.createElement("div");
    this.root.className = "settings-backdrop";
    this.root.addEventListener("pointerdown", (e) => {
      this.downOnBackdrop = e.target === this.root;
    });
    this.root.addEventListener("click", (e) => {
      if (e.currentTarget === e.target && this.downOnBackdrop) {
        this.hide();
      }
      this.downOnBackdrop = false;
    });

    this.achievements = document.createElement("div");
    this.achievements.className = "achievement-modal";
    this.achievements.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.root.appendChild(this.achievements);
    this.achievements.innerHTML = `
  <h2>Achievements</h2>
  <div class="achievement-list">
    <div class="achievement-card">
      <div class="info">
        <span class="label">Distance Driven</span>
        <span id="distance-driven" class="value"></span>
      </div>
    </div>
    <div class="achievement-card">
      <div class="info">
        <span class="label">Path Navigation</span>
        <span id="path-followed" class="value"></span>
      </div>
    </div>

    <!-- Rotations -->
    <div class="achievement-card" style="display: none">
      <div class="info">
        <span class="label">Total Spins</span>
        <span id="rotations" class="value"></span>
      </div>
    </div>
    <div class="achievement-card">
      <div class="info">
        <span class="label">Shots Scored</span>
        <span id="shots" class="value"></span>
      </div>
    </div>
    <div class="achievement-card">
      <div class="info">
        <span class="label">Fuel Collected</span>
        <span id="fuel" class="value"></span>
      </div>
    </div>
  </div>
    `;
    this.distanceDriven = this.achievements.querySelector<HTMLSpanElement>('#distance-driven')!;
    this.pathFollowed = this.achievements.querySelector<HTMLSpanElement>('#path-followed')!;
    this.rotations = this.achievements.querySelector<HTMLSpanElement>('#rotations')!;
    this.shots = this.achievements.querySelector<HTMLSpanElement>('#shots')!;
    this.fuel = this.achievements.querySelector<HTMLSpanElement>('#fuel')!;

    this.dialog = document.createElement("div");
    this.dialog.className = "settings-dialog";
    this.dialog.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.root.appendChild(this.dialog);

    this.dialog.innerHTML = `
        <h2>Settings</h2>
        <label>Kp (for aiming):
        <input type="number" step="0.05" id="kp">
        </label>
    `;
    this.table = new Table(["Distance", "RPM"], this.game.getRpmTable());
    this.tableUnsubscribe = this.table.onChange(() => this.game.saveRpmTable());
    this.dialog.appendChild(this.table.element);

    this.kPInput = this.dialog.querySelector("#kp") as HTMLInputElement;
    this.kPInput.value = String(this.game.getKp());
    this.kPInput.addEventListener("change", () => {
      const value = this.kPInput.valueAsNumber;
      if (Number.isNaN(value)) {
        return false;
      }
      this.game.setKp(value);
      return true;
    });

    const clearButton = document.createElement("button");
    clearButton.className = "dialog-button";
    clearButton.textContent = "Reset all data";
    clearButton.style.background = "red";
    clearButton.addEventListener("click", () => {
      this.game.clearStorage();
      this.game.getRpmTable().clear();
      this.game.reload();
    });
    this.dialog.appendChild(clearButton);

    const closeButton = document.createElement("button");
    closeButton.className = "dialog-button";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", () => {
      this.hide();
    });
    this.dialog.appendChild(closeButton);

    document.body.appendChild(this.root);
    this.hide();
  }

  load(level: Level) {
    const table = new Table(["Distance", "RPM"], this.game.getRpmTable());
    this.tableUnsubscribe();
    this.table.element.remove();
    this.dialog.insertBefore(
      table.element,
      this.dialog.querySelector("button"),
    );
    this.table = table;
    this.tableUnsubscribe = this.table.onChange(() => this.game.saveRpmTable());
    if (level.info.index < 5) {
      this.table.element.style.display = "none";
    } else {
      this.table.element.style.display = "block";
    }
    if (level.info.index < 9) {
      this.kPInput.style.display = "none";
    } else {
      this.kPInput.style.display = "block";
    }
  }

  show(achievements = false) {
    this.root.style.display = "flex";
    if (achievements) {
      this.dialog.style.display = "none";
      this.achievements.style.display = "block";
      this.distanceDriven.innerHTML = this.game.achievements.formatDistance('distance-driven');
      this.pathFollowed.innerHTML = this.game.achievements.formatDistance('path-followed');
      this.rotations.innerHTML = this.game.achievements.formatRotations('rotations');
      this.shots.innerHTML = this.game.achievements.formatNumber('shots');
      this.fuel.innerHTML = this.game.achievements.formatNumber('fuel');
    } else {
      this.dialog.style.display = "block";
      this.achievements.style.display = "none";
    }
  }

  hide() {
    this.root.style.display = "none";
  }

  clear() {}
}
