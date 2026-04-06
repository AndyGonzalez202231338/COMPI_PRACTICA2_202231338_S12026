import { Injectable, signal, computed } from '@angular/core';
import { AnalyzerSummary } from './wison';

@Injectable({ providedIn: 'root' })
export class AnalyzerService {
  // Lista de analizadores disponibles
  private _analyzers = signal<AnalyzerSummary[]>([]);
  // Nombre del analizador actualmente seleccionado en el tester
  private _selected  = signal<string | null>(null);

  readonly analyzers = this._analyzers.asReadonly();
  readonly selected  = this._selected.asReadonly();

  readonly hasAnalyzers = computed(() => this._analyzers().length > 0);

  setAnalyzers(list: AnalyzerSummary[]): void {
    this._analyzers.set(list);
  }

  addOrReplace(summary: AnalyzerSummary): void {
    const current = this._analyzers();
    const idx = current.findIndex(a => a.name === summary.name);
    if (idx >= 0) {
      const updated = [...current];
      updated[idx] = summary;
      this._analyzers.set(updated);
    } else {
      this._analyzers.set([...current, summary]);
    }
  }

  remove(name: string): void {
    this._analyzers.set(this._analyzers().filter(a => a.name !== name));
    if (this._selected() === name) this._selected.set(null);
  }

  select(name: string | null): void {
    this._selected.set(name);
  }

  getByName(name: string): AnalyzerSummary | undefined {
    return this._analyzers().find(a => a.name === name);
  }
}