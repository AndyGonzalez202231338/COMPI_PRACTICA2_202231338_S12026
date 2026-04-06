/* 
   API REST con Express.
   Endpoints:
     POST   /api/parse              → parsea código Wison y genera el analizador
     GET    /api/analyzers          → lista todos los analizadores creados
     GET    /api/analyzers/:name    → obtiene un analizador por nombre
     DELETE /api/analyzers/:name    → elimina un analizador
     POST   /api/evaluate           → evalúa una cadena con un analizador
*/

'use strict';

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

// Módulos del compilador
const { symbolTable }  = require('./symbol-table/table.js');
const { generate }     = require('./src/ll-generator.js');
const { evaluate }     = require('./src/evaluator.js');

// Cargar el parser generado por Jison
const parserPath = path.join(__dirname, 'grammar', 'wison_parser.js');
if (!fs.existsSync(parserPath)) {
    console.error('ERROR: grammar/wison_parser.js no existe.');
    console.error('Ejecuta: npm run build:parser');
    process.exit(1);
}
const parserSrc = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
new Function('module', 'exports', 'require', parserSrc)(parserModule, parserModule.exports, require);
const { parser } = parserModule.exports;

// Persistencia en disco
const STORAGE_FILE = path.join(__dirname, 'analyzers.json');

function loadFromDisk() {
    if (!fs.existsSync(STORAGE_FILE)) return;
    try {
        const data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
        if (Array.isArray(data)) {
            data.forEach(entry => symbolTable.add(entry));
            console.log(`Cargados ${data.length} analizador(es) desde disco.`);
        }
    } catch (e) {
        console.warn('No se pudo cargar analyzers.json:', e.message);
    }
}

function saveToDisk() {
    try {
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(symbolTable.getAll(), null, 2), 'utf8');
    } catch (e) {
        console.warn('No se pudo guardar analyzers.json:', e.message);
    }
}

function parseWison(source) {
    let captured = null;
    parser.yy.parseError = function(msg, hash) {
        const isLexical = hash?.token === 'LEXICAL_ERROR';
        const char = hash?.text || '';
        captured = {
            type:     isLexical ? 'lexical' : 'syntactic',
            message:  isLexical
                      ? `Carácter no reconocido: "${char}" (U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')})`
                      : msg,
            line:     hash?.loc?.first_line ?? null,
            col:      hash?.loc?.first_column ?? null,
            expected: isLexical ? null : (hash?.expected ?? null),
            token:    isLexical ? char : (hash?.token ?? null)
        };
        throw new Error(captured.message);
    };
    try {
        return { ok: true, ast: parser.parse(source) };
    } catch (e) {
        return {
            ok: false,
            ...(captured || { type: 'lexical', message: e.message, line: null })
        };
    }
}

// Normalizar texto
function normalizeSource(source) {
    return source
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/\u2190/g, '<-')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/^\uFEFF/, '');
}

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Cargar analizadores persistidos al arrancar
loadFromDisk();

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', analyzers: symbolTable.size });
});

// POST /api/parse
app.post('/api/parse', (req, res) => {
    const { source, name } = req.body;

    if (!source || typeof source !== 'string') {
        return res.status(400).json({ ok: false, error: 'Campo "source" requerido.' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ ok: false, error: 'Campo "name" requerido.' });
    }

    const cleanSource = normalizeSource(source);

    // Etapa 1: análisis léxico y sintáctico
    const parseResult = parseWison(cleanSource);
    if (!parseResult.ok) {
        return res.status(422).json({
            ok:       false,
            stage:    parseResult.type,
            error:    parseResult.message,
            line:     parseResult.line,
            col:      parseResult.col,
            expected: parseResult.expected,
            token:    parseResult.token
        });
    }

    // Etapa 2: análisis semántico + generación LL(1)
    const genResult = generate(parseResult.ast, name.trim());
    if (!genResult.ok) {
        return res.status(422).json({
            ok:            false,
            stage:         'semantic',
            errors:        genResult.errors,
            warnings:      genResult.warnings,
            leftRecursion: genResult.leftRecursion || [],
            conflicts:     genResult.conflicts || []
        });
    }

    // Guardar en tabla y persistir en disco
    symbolTable.add(genResult.entry);
    saveToDisk();

    return res.status(201).json({
        ok:      true,
        name:    genResult.entry.name,
        warnings: genResult.entry.warnings,
        summary: {
            terminalCount: genResult.entry.grammar.terminals.length,
            ntCount:       genResult.entry.grammar.nonTerminals.length,
            initialSymbol: genResult.entry.grammar.initialSymbol,
            tableSize:     Object.keys(genResult.entry.parseTable).length
        }
    });
});

// GET /api/analyzers
app.get('/api/analyzers', (_req, res) => {
    res.json({ ok: true, analyzers: symbolTable.getSummaries() });
});

// GET /api/analyzers/:name
app.get('/api/analyzers/:name', (req, res) => {
    const entry = symbolTable.get(req.params.name);
    if (!entry) {
        return res.status(404).json({ ok: false, error: `Analizador "${req.params.name}" no encontrado.` });
    }
    res.json({ ok: true, entry });
});

// DELETE /api/analyzers/:name
app.delete('/api/analyzers/:name', (req, res) => {
    const deleted = symbolTable.remove(req.params.name);
    if (!deleted) {
        return res.status(404).json({ ok: false, error: `Analizador "${req.params.name}" no encontrado.` });
    }
    saveToDisk();
    res.json({ ok: true, message: `Analizador "${req.params.name}" eliminado.` });
});


// POST /api/evaluate
app.post('/api/evaluate', (req, res) => {
    const { name, input } = req.body;

    if (!name || typeof name !== 'string') {
        return res.status(400).json({ ok: false, error: 'Campo "name" requerido.' });
    }
    if (input === undefined || input === null) {
        return res.status(400).json({ ok: false, error: 'Campo "input" requerido.' });
    }

    const entry = symbolTable.get(name);
    if (!entry) {
        return res.status(404).json({ ok: false, error: `Analizador "${name}" no encontrado.` });
    }

    const result = evaluate(entry, String(input));

    return res.json({
        ok:       true,
        accepted: result.accepted,
        tokens:   result.tokens,
        tree:     result.treeJSON,
        steps:    result.steps,
        errors:   result.errors
    });
});

// Arrancar servidor 
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log('Endpoints disponibles:');
    console.log('  POST   /api/parse');
    console.log('  GET    /api/analyzers');
    console.log('  GET    /api/analyzers/:name');
    console.log('  DELETE /api/analyzers/:name');
    console.log('  POST   /api/evaluate');
});

module.exports = app;