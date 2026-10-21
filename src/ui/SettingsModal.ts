import type { Game } from "../core/Game";
import type { Level } from "../levels/Level";

import './SettingsModal.css';
import { Table } from "./Table";

export class SettingsModal {
  private root: HTMLDivElement;
  private dialog: HTMLDivElement;
  private table: Table;
  private tableUnsubscribe: () => void;
  private downOnBackdrop = false;

  constructor(private readonly game: Game) {
    this.root = document.createElement('div');
    this.root.className = 'settings-backdrop';
    this.root.addEventListener('pointerdown', (e) => {
        this.downOnBackdrop = (e.target === this.root);
    });
    this.root.addEventListener('click', (e) => {
      if (e.currentTarget === e.target && this.downOnBackdrop) {
        this.hide();
      }
      this.downOnBackdrop = false;
    });

    this.dialog = document.createElement('div');
    this.dialog.className = 'settings-dialog';
    this.dialog.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.root.appendChild(this.dialog);

    this.dialog.innerHTML = `
        <h2>Settings</h2>
    `;
    this.table = new Table(["Distance", "RPM"], this.game.getRpmTable());
    this.tableUnsubscribe = this.table.onChange(() => this.game.saveRpmTable());
    this.dialog.appendChild(this.table.element);

    const clearButton = document.createElement('button');
    clearButton.className = 'dialog-button';
    clearButton.textContent = 'Reset all data';
    clearButton.style.background = 'red';
    clearButton.addEventListener('click', () => {
        this.game.clearStorage();
        this.game.getRpmTable().clear();
        this.game.reload();
    });
    this.dialog.appendChild(clearButton);

    const closeButton = document.createElement('button');
    closeButton.className = 'dialog-button';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => {
        this.hide();
    })
    this.dialog.appendChild(closeButton);

    document.body.appendChild(this.root);
    this.hide();
  }

  load(level: Level) {
    const table = new Table(['Distance', 'RPM'], this.game.getRpmTable());
    this.tableUnsubscribe();
    this.table.element.remove();
    this.dialog.insertBefore(table.element, this.dialog.querySelector('button'));
    this.table = table;
    this.tableUnsubscribe = this.table.onChange(() => this.game.saveRpmTable());
    if (level.info.index < 5) {
        this.table.element.style.display = 'none';
    } else {
        this.table.element.style.display = 'block';
    }
  }

  show() {
    this.root.style.display = 'flex';
  }

  hide() {
    this.root.style.display = 'none';
  }

  clear() {

  }
}