import { Component, inject, signal, computed, ElementRef } from '@angular/core';
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

  // Números de línea calculados desde el código
  lineNumbers_ = computed(() => {
    const count = (this.code().split('\n').length) || 1;
    return Array.from({ length: count }, (_, i) => i + 1);
  });

  // Sincroniza el scroll del textarea con el div de números de línea
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
        this.wisonSvc.getAnalyzers().subscribe(list => {
          this.analyzerSvc.setAnalyzers(list.analyzers);
        });
      },
      error: (err: any) => {
        this.loading.set(false);
        const body = err.error;

        if (body?.errors) {
          // Errores semánticos: array con descripción y NT afectado
          this.errors.set(body.errors.map((m: string) => ({
            type:    'semantic' as const,
            message: m,
            // Extraer el NT del mensaje para mostrar contexto
            context: this.extractNT(m)
          })));
          // También mostrar recursión izquierda con detalle si existe
          if (body.leftRecursion?.length) {
            const extra: AppError[] = body.leftRecursion.map((r: any) => ({
              type:    'semantic' as const,
              message: r.description,
              context: r.nt
            }));
            this.errors.set([...this.errors(), ...extra]);
          }
        } else {
          this.errors.set([{
            type:     body?.stage || 'syntactic',
            message:  body?.error || err.message,
            line:     body?.line  ?? null,
            col:      body?.col   ?? null,
            expected: Array.isArray(body?.expected)
                      ? body.expected.join(' | ')
                      : body?.expected ?? null,
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
      if (!this.name()) {
        this.name.set(file.name.replace(/\.wison$/, ''));
      }
    };
    reader.readAsText(file);
  }

  onDelete(name: string): void {
    this.wisonSvc.deleteAnalyzer(name).subscribe({
      next: () => {
        this.analyzerSvc.remove(name);
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
}