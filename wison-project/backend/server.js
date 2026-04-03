/* 
   API REST con Express.
   Endpoints:
     POST /api/parse             parsea código Wison y genera el analizador
     GET  /api/analyzers         lista todos los analizadores creados
     GET  /api/analyzers/:name   obtiene un analizador por nombre
     DELETE /api/analyzers/:name elimina un analizador
     POST /api/evaluate          evalúa una cadena con un analizador
*/

'use strict';

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

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

/** Parsea código Wison y retorna el AST o lanza un objeto de error. */
function parseWison(source) {
    let captured = null;
    parser.yy.parseError = function(msg, hash) {
        captured = {
            type:     hash?.token !== undefined ? 'syntactic' : 'lexical',
            message:  msg,
            line:     hash?.loc?.first_line ?? null,
            col:      hash?.loc?.first_column ?? null,
            expected: hash?.expected ?? null,
            token:    hash?.token ?? null
        };
        throw new Error(msg);
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


app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', analyzers: symbolTable.size });
});

/**
 * POST /api/parse
 * Cuerpo: { source: string, name: string }
 * 
 * 1. Normaliza el source
 * 2. Parsea con el parser Wison (léxico + sintáctico)
 * 3. Pasa el AST por ll-generator (semántico + FIRST/FOLLOW/tabla)
 * 4. Guarda en SymbolTable y retorna el resumen
 */ 
app.post('/api/parse', (req, res) => {
    const { source, name } = req.body;

    if (!source || typeof source !== 'string') {
        return res.status(400).json({ ok: false, error: 'Campo "source" requerido.' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ ok: false, error: 'Campo "name" requerido.' });
    }

    const cleanSource = normalizeSource(source);

    // Etapa 1: análisis léxico y sintáctico (Jison) 
    const parseResult = parseWison(cleanSource);
    if (!parseResult.ok) {
        return res.status(422).json({
            ok:     false,
            stage:  parseResult.type,          // 'lexical' | 'syntactic'
            error:  parseResult.message,
            line:   parseResult.line,
            col:    parseResult.col,
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

    // Etapa 3: guardar en tabla de símbolos 
    symbolTable.add(genResult.entry);

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


/**
 * GET /api/analyzers
 * Retorna la lista resumida de todos los analizadores guardados.
 */
app.get('/api/analyzers', (_req, res) => {
    res.json({ ok: true, analyzers: symbolTable.getSummaries() });
});


/**
 * GET /api/analyzers/:name
 * Retorna el analizador completo (con tabla LL, FIRST, FOLLOW).
 */
app.get('/api/analyzers/:name', (req, res) => {
    const entry = symbolTable.get(req.params.name);
    if (!entry) {
        return res.status(404).json({ ok: false, error: `Analizador "${req.params.name}" no encontrado.` });
    }
    res.json({ ok: true, entry });
});

/**
 * DELETE /api/analyzers/:name
 * Elimina un analizador de la tabla de símbolos.
 */
app.delete('/api/analyzers/:name', (req, res) => {
    const deleted = symbolTable.remove(req.params.name);
    if (!deleted) {
        return res.status(404).json({ ok: false, error: `Analizador "${req.params.name}" no encontrado.` });
    }
    res.json({ ok: true, message: `Analizador "${req.params.name}" eliminado.` });
});

/**
 * POST /api/evaluate
 * Cuerpo: { name: string, input: string }
 *
 * Evalúa la cadena de entrada usando el analizador especificado.
 * Retorna si fue aceptada, el árbol de derivación y errores si hubo.
 */
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