import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ParseRequest  { source: string; name: string; }
export interface EvalRequest   { name: string; input: string; }

export interface AnalyzerSummary {
  name: string;
  createdAt: string;
  terminalCount: number;
  ntCount: number;
  initialSymbol: string;
  warnings: string[];
}

export interface TreeNode {
  label: string;
  lexeme: string | null;
  isTerminal: boolean;
  children: TreeNode[];
}

export interface EvalError {
  type: 'lexical' | 'syntactic';
  message: string;
  pos?: number;
  expected?: string;
  found?: string;
}

export interface Token {
  name: string;
  lexeme: string;
  pos: number;
}

@Injectable({ providedIn: 'root' })
export class WisonService {
  private http = inject(HttpClient);
  private api  = 'http://localhost:3000/api';

  /** Parsea código Wison y crea el analizador en el backend. */
  parse(source: string, name: string): Observable<any> {
    return this.http.post(`${this.api}/parse`, { source, name });
  }

  /** Lista resumida de todos los analizadores guardados. */
  getAnalyzers(): Observable<{ ok: boolean; analyzers: AnalyzerSummary[] }> {
    return this.http.get<any>(`${this.api}/analyzers`);
  }

  /** Obtiene un analizador completo por nombre. */
  getAnalyzer(name: string): Observable<any> {
    return this.http.get<any>(`${this.api}/analyzers/${encodeURIComponent(name)}`);
  }

  /** Elimina un analizador. */
  deleteAnalyzer(name: string): Observable<any> {
    return this.http.delete<any>(`${this.api}/analyzers/${encodeURIComponent(name)}`);
  }

  /** Evalúa una cadena de entrada con el analizador indicado. */
  evaluate(name: string, input: string): Observable<any> {
    return this.http.post<any>(`${this.api}/evaluate`, { name, input });
  }
}