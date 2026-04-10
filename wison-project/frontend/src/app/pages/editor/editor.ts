import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WisonService } from '../../services/wison';
import { AnalyzerService } from '../../services/analyzer';
import { ErrorPanel, AppError } from '../../components/error-panel/error-panel';

@Component({
  selector: 'app-editor',
  imports: [FormsModule, ErrorPanel],
  templateUrl: './editor.html',
  styleUrl: './editor.css'
})
export class Editor {
  private wisonSvc    = inject(WisonService);
  private analyzerSvc = inject(AnalyzerService);

  code      = signal('');
  name      = signal('');
  loading   = signal(false);
  success   = signal<string | null>(null);
  errors    = signal<AppError[]>([]);
  warnings  = signal<string[]>([]);

  analyzers = this.analyzerSvc.analyzers;

  // Modal de detalles
  modalOpen     = signal(false);
  modalName     = signal<string | null>(null);
  detailLoading = signal(false);
  detailData    = signal<any>(null);
  private detailCache = new Map<string, any>();

  lineNumbers_ = computed(() => {
    const count = (this.code().split('\n').length) || 1;
    return Array.from({ length: count }, (_, i) => i + 1);
  });

  formatProduction(prod: any): string {
    const alts = prod.alternatives.map((alt: any[]) =>
      alt.length === 0 ? 'ε' : alt.map((s: any) => s.name).join(' ')
    );
    return `${prod.head}  <=  ${alts.join('  |  ')}`;
  }

  formatSet(set: string[]): string {
    return set?.length ? set.join(', ') : '∅';
  }

  openDetail(name: string): void {
    this.modalName.set(name);
    this.modalOpen.set(true);

    if (this.detailCache.has(name)) {
      this.detailData.set(this.detailCache.get(name));
      return;
    }
    this.detailLoading.set(true);
    this.detailData.set(null);
    this.wisonSvc.getAnalyzer(name).subscribe({
      next: (res: any) => {
        this.detailCache.set(name, res.entry);
        this.detailData.set(res.entry);
        this.detailLoading.set(false);
      },
      error: () => this.detailLoading.set(false)
    });
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.modalName.set(null);
    this.detailData.set(null);
  }

  syncScroll(textarea: HTMLTextAreaElement, lineDiv: HTMLElement): void {
    lineDiv.scrollTop = textarea.scrollTop;
  }

  onCodeInput(event: Event, lineDiv?: HTMLElement): void {
    const ta = event.target as HTMLTextAreaElement;
    this.code.set(ta.value);
    if (lineDiv) lineDiv.scrollTop = ta.scrollTop;
  }

  onParse(): void {
    const src  = this.code().trim();
    const name = this.name().trim();
    if (!src || !name) return;

    this.loading.set(true);
    this.success.set(null);
    this.errors.set([]);
    this.warnings.set([]);

    this.wisonSvc.parse(src, name).subscribe({
      next: (res: any) => {
        this.loading.set(false);
        this.warnings.set(res.warnings || []);
        this.success.set(`Analizador "${res.name}" creado exitosamente.`);
        this.detailCache.delete(name);
        this.wisonSvc.getAnalyzers().subscribe(list => {
          this.analyzerSvc.setAnalyzers(list.analyzers);
        });
      },
      error: (err: any) => {
        this.loading.set(false);
        const body = err.error;
        if (body?.errors && Array.isArray(body.errors)) {
          const stage = body.stage || 'syntactic';
          const mapped: AppError[] = body.errors.map((e: any) => {
            if (typeof e === 'string') return { type: stage as any, message: e, context: this.extractNT(e) };
            return {
              type:     (e.type || stage) as any,
              message:  e.message,
              line:     e.line  ?? null,
              col:      e.col   ?? null,
              expected: Array.isArray(e.expected) ? e.expected.join(' | ') : (e.expected ?? null),
              found:    e.token ?? e.found ?? null,
              context:  e.context ?? this.extractNT(e.message)
            };
          });
          this.errors.set(mapped);
        } else {
          this.errors.set([{
            type:     (body?.stage || 'syntactic') as any,
            message:  body?.error || err.message,
            line:     body?.line  ?? null,
            col:      body?.col   ?? null,
            expected: Array.isArray(body?.expected) ? body.expected.join(' | ') : body?.expected ?? null,
            found:    body?.token ?? null
          }]);
        }
        this.warnings.set(body?.warnings || []);
      }
    });
  }

  private extractNT(msg: string): string | null {
    const m = msg.match(/"(%_[^"]+)"/);
    return m ? m[1] : null;
  }

  onLoadFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.code.set(reader.result as string);
      if (!this.name()) this.name.set(file.name.replace(/\.wison$/, ''));
    };
    reader.readAsText(file);
  }

  onDelete(name: string): void {
    this.wisonSvc.deleteAnalyzer(name).subscribe({
      next: () => {
        this.analyzerSvc.remove(name);
        this.detailCache.delete(name);
        if (this.modalName() === name) this.closeModal();
        if (this.success()?.includes(name)) this.success.set(null);
      },
      error: () => {}
    });
  }

  onClear(): void {
    this.code.set('');
    this.name.set('');
    this.errors.set([]);
    this.warnings.set([]);
    this.success.set(null);
  }

  objectEntries(obj: any): [string, any][] {
    return obj ? Object.entries(obj) : [];
  }
}
