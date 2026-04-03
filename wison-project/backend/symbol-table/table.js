/*
   Tabla de símbolos en memoria.
   Almacena los AnalyzerEntry generados por ll-generator.js
   y los expone con operaciones CRUD simples.
*/

'use strict';

class SymbolTable {
    constructor() {
        // Map<string, AnalyzerEntry>
        this._table = new Map();
    }

    /**
     * Agrega o reemplaza un analizador.
     * Si ya existe uno con el mismo nombre lo sobreescribe.
     */
    add(entry) {
        if (!entry || !entry.name) {
            throw new Error('El entry debe tener un campo "name".');
        }
        this._table.set(entry.name, entry);
        return entry;
    }

    /**
     * Elimina un analizador por nombre.
     * Retorna true si existía, false si no.
     */
    remove(name) {
        return this._table.delete(name);
    }

    // Lectura de analizadores

    /** Retorna el entry completo o undefined si no existe. */
    get(name) {
        return this._table.get(name);
    }

    /** Retorna true si existe un analizador con ese nombre. */
    exists(name) {
        return this._table.has(name);
    }

    /**
     * Retorna todos los analizadores como array.
     * Para el listado del frontend: incluye solo los campos de resumen,
     * no la tabla M completa (que puede ser grande).
     */
    getAll() {
        return [...this._table.values()];
    }

    /**
     * Retorna un resumen liviano de cada analizador (para el listado).
     */
    getSummaries() {
        return [...this._table.values()].map(e => ({
            name:           e.name,
            createdAt:      e.createdAt,
            terminalCount:  e.grammar.terminals.length,
            ntCount:        e.grammar.nonTerminals.length,
            initialSymbol:  e.grammar.initialSymbol,
            warnings:       e.warnings || []
        }));
    }

    /** Número de analizadores almacenados. */
    get size() {
        return this._table.size;
    }

    /** Limpia toda la tabla. */
    clear() {
        this._table.clear();
    }
}

// Singleton - toda la aplicación comparte la misma instancia
const symbolTable = new SymbolTable();

module.exports = { symbolTable, SymbolTable };