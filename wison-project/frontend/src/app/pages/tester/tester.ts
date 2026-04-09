import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WisonService, TreeNode } from '../../services/wison';
import { AnalyzerService } from '../../services/analyzer';
import { ErrorPanel, AppError } from '../../components/error-panel/error-panel';
import { TreeViewer } from '../../components/tree-viewer/tree-viewer';

@Component({
  selector: 'app-tester',
  imports: [FormsModule, ErrorPanel, TreeViewer],
  templateUrl: './tester.html',
  styleUrl: './tester.css'
})
export class Tester implements OnInit {
  private wisonSvc    = inject(WisonService);
  private analyzerSvc = inject(AnalyzerService);

  analyzers    = this.analyzerSvc.analyzers;
  selectedName = signal<string>('');
  input        = signal('');
  loading      = signal(false);
  accepted     = signal<boolean | null>(null);
  tree         = signal<TreeNode | null>(null);
  errors       = signal<AppError[]>([]);
  tokens       = signal<{ name: string; lexeme: string }[]>([]);

  ngOnInit(): void {
    // Cargar lista de analizadores al entrar a la página
    this.wisonSvc.getAnalyzers().subscribe(res => {
      this.analyzerSvc.setAnalyzers(res.analyzers);
      // Si hay uno preseleccionado en el servicio, usarlo
      const sel = this.analyzerSvc.selected();
      if (sel) this.selectedName.set(sel);
      else if (res.analyzers.length > 0) this.selectedName.set(res.analyzers[0].name);
    });
  }

  onEvaluate(): void {
    const name  = this.selectedName();
    const input = this.input().trim();
    if (!name) return;

    this.loading.set(true);
    this.accepted.set(null);
    this.tree.set(null);
    this.errors.set([]);
    this.tokens.set([]);

    this.wisonSvc.evaluate(name, input).subscribe({
      next: (res: any) => {
        this.loading.set(false);
        this.accepted.set(res.accepted);
        this.tree.set(res.accepted ? res.tree : null);
        this.tokens.set(res.tokens || []);
        this.errors.set((res.errors || []).map((e: any) => ({
          type:     e.type,
          message:  e.message,
          line:     e.line  ?? null,
          col:      e.col   ?? null,
          expected: Array.isArray(e.expected) ? e.expected.join(', ') : (e.expected ?? null),
          found:    e.found ?? null
        })));
      },
      error: (err: any) => {
        this.loading.set(false);
        this.errors.set([{ type: 'syntactic', message: err.error?.error || err.message }]);
      }
    });
  }

  onSelectAnalyzer(name: string): void {
    this.selectedName.set(name);
    this.analyzerSvc.select(name);
    this.reset();
  }

  onLoadFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => this.input.set(reader.result as string);
    reader.readAsText(file);
  }

  onClear(): void {
    this.input.set('');
    this.reset();
  }

  private reset(): void {
    this.accepted.set(null);
    this.tree.set(null);
    this.errors.set([]);
    this.tokens.set([]);
  }
}