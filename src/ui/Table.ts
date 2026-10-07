import './Table.css';

interface Row {
  key: number;
  /** The key was edited; re-sort once focus leaves the row. */
  dirty: boolean;
  tr: HTMLTableRowElement;
}

/**
 * An editable two-column table of numbers, backed by a Map<number, number>.
 * Rows are kept sorted by the first column (ascending), there is always an
 * empty row at the bottom for adding entries, and each row has a remove button.
 *
 * Keys are unique: a duplicate key is rejected (the input flashes red and
 * reverts) rather than overwriting the existing row.
 */
export class Table {
  readonly element: HTMLDivElement;

  private readonly map: Map<number, number>;
  private readonly body: HTMLTableSectionElement;
  private readonly rows: Row[] = [];
  private readonly handlers: Array<(values: Map<number, number>) => void> = [];

  constructor(headers: [string, string], initialValues: Map<number, number> = new Map()) {
    this.map = new Map(initialValues);

    this.element = document.createElement('div');
    this.element.className = 'data-table';

    const table = document.createElement('table');
    const headRow = table.createTHead().insertRow();
    for (const text of [...headers, '']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = text;
      headRow.append(th);
    }
    this.body = table.createTBody();
    this.buildDraftRow(table.createTFoot().insertRow(), headers);
    this.element.append(table);

    for (const [key, value] of this.map) this.addRow(key, value);
    this.sortRows();
  }

  getRoot(): HTMLElement {
    return this.element;
  }

  /** A copy of the current values, in ascending key order. */
  values(): Map<number, number> {
    return new Map([...this.map].sort(([a], [b]) => a - b));
  }

  /** Called after every edit, add or remove. Returns an unsubscribe function. */
  onChange(handler: (values: Map<number, number>) => void): () => void {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  highlight(...indices: [] | [number] | [number, number]) {
    if (indices.length === 2 && Math.abs(indices[0] - indices[1]) !== 1) {
      throw new RangeError(`highlight() takes adjacent indices, got ${indices[0]} and ${indices[1]}`);
    }
 
    for (const row of this.rows) row.tr.classList.remove('highlight');
 
    // Resolve against sorted key order, which can briefly differ from the DOM
    // order while a just-edited row waits for focus to leave it.
    const sorted = [...this.rows].sort((a, b) => a.key - b.key);
    for (const i of indices) sorted[i]?.tr.classList.add('highlight');
  }

  // --- rows ----------------------------------------------------------------

  /** Build the DOM for a row whose entry is already in `this.map`. */
  private addRow(key: number, value: number) {
    const tr = document.createElement('tr');
    const row: Row = { key, dirty: false, tr };

    const keyInput = numberInput(key, 'Key', 1);
    const valueInput = numberInput(value, 'Value', 100);

    keyInput.addEventListener('change', () => {
      const next = keyInput.valueAsNumber;
      if (Number.isNaN(next) || (next !== row.key && this.map.has(next))) {
        keyInput.value = String(row.key); // empty or duplicate: revert
        flagInvalid(keyInput);
        return;
      }
      if (next === row.key) return;
      const current = this.map.get(row.key)!;
      this.map.delete(row.key);
      this.map.set(next, current);
      row.key = next;
      row.dirty = true;
      this.emit();
    });

    valueInput.addEventListener('change', () => {
      const next = valueInput.valueAsNumber;
      if (Number.isNaN(next)) {
        valueInput.value = String(this.map.get(row.key));
        flagInvalid(valueInput);
        return;
      }
      this.map.set(row.key, next);
      this.emit();
    });

    // Enter commits the edit but keeps focus where it is.
    tr.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
      const input = e.target;
      input.blur(); // fires 'change' and 'focusout'
      input.focus();
    });

    // Re-sort only once focus leaves the row, so Tab from key to value keeps working.
    tr.addEventListener('focusout', (e) => {
      if (!row.dirty || tr.contains(e.relatedTarget as Node | null)) return;
      row.dirty = false;
      setTimeout(() => this.sortRows(), 0); // wait until focus has settled
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = '×';
    remove.title = 'Remove row';
    remove.setAttribute('aria-label', 'Remove row');
    remove.addEventListener('click', () => {
      this.map.delete(row.key);
      this.rows.splice(this.rows.indexOf(row), 1);
      tr.remove();
      this.emit();
    });

    for (const child of [keyInput, valueInput, remove]) {
      tr.insertCell().append(child);
    }
    this.rows.push(row);
    this.body.append(tr);
  }

  /** Reorder the existing row elements by key, keeping whatever is focused. */
  private sortRows() {
    const active = document.activeElement as HTMLElement | null;
    this.rows.sort((a, b) => a.key - b.key);
    for (const row of this.rows) this.body.append(row.tr); // append moves existing nodes
    if (active && this.element.contains(active) && document.activeElement !== active) {
      active.focus(); // moving a node can drop focus
    }
  }

  // --- the "add a row" row -------------------------------------------------

  private buildDraftRow(tr: HTMLTableRowElement, headers: [string, string]) {
    tr.className = 'draft';
    const keyInput = numberInput(undefined, headers[0], 1);
    const valueInput = numberInput(undefined, headers[1], 100);
    keyInput.placeholder = headers[0];
    valueInput.placeholder = headers[1];

    // Add the entry once both fields hold a number.
    const tryCommit = (): boolean => {
      const key = keyInput.valueAsNumber;
      const value = valueInput.valueAsNumber;
      if (Number.isNaN(key) || Number.isNaN(value)) return false;
      if (this.map.has(key)) {
        flagInvalid(keyInput);
        return false;
      }
      this.map.set(key, value);
      this.addRow(key, value);
      keyInput.value = '';
      valueInput.value = '';
      this.sortRows();
      this.emit();
      return true;
    };

    for (const input of [keyInput, valueInput]) {
      input.addEventListener('change', tryCommit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && tryCommit()) keyInput.focus(); // ready for the next entry
      });
    }

    tr.insertCell().append(keyInput);
    tr.insertCell().append(valueInput);
    tr.insertCell(); // aligns with the remove-button column
  }

  private emit() {
    if (this.handlers.length === 0) return;
    const values = this.values();
    for (const handler of this.handlers) handler(values);
  }
}

function numberInput(value: number | undefined, label: string, step: number): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = `${step}`;
  input.setAttribute('aria-label', label);
  if (value !== undefined) input.value = String(value);
  return input;
}

/** Flash an input red until the user types in it again. */
function flagInvalid(input: HTMLInputElement) {
  input.classList.add('invalid');
  input.addEventListener('input', () => input.classList.remove('invalid'), { once: true });
}