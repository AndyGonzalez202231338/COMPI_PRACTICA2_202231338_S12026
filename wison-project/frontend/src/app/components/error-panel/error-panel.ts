import { Component, input } from '@angular/core';
import { NgClass } from '@angular/common';

export interface AppError {
  type: 'lexical' | 'syntactic' | 'semantic';
  message: string;
  line?: number | null;
  col?: number | null;
  expected?: string[] | string | null;
  found?: string | null;
  context?: string | null;  // NT afectado en errores semánticos
}

@Component({
  selector: 'app-error-panel',
  imports: [NgClass],
  templateUrl: './error-panel.html',
  styleUrl: './error-panel.css'
})
export class ErrorPanel {
  errors   = input<AppError[]>([]);
  warnings = input<string[]>([]);

  typeLabel(type: string): string {
    switch (type) {
      case 'lexical':   return 'Léxico';
      case 'syntactic': return 'Sintáctico';
      case 'semantic':  return 'Semántico';
      default:          return type;
    }
  }

  typeClass(type: string): string {
    switch (type) {
      case 'lexical':   return 'badge-lexical';
      case 'syntactic': return 'badge-syntactic';
      case 'semantic':  return 'badge-semantic';
      default:          return '';
    }
  }

  hasLocation(e: AppError): boolean {
    return e.line != null && e.line !== undefined;
  }

  locationText(e: AppError): string {
    if (!e.line) return '';
    return e.col != null ? `Línea ${e.line}, Col ${e.col}` : `Línea ${e.line}`;
  }
}