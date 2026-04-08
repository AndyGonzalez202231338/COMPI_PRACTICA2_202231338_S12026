/* 
   API REST con Express.
   Endpoints:
    POST   /api/parse               parsea código Wison y genera el analizador
    GET    /api/analyzers           lista todos los analizadores creados
    GET    /api/analyzers/:name     obtiene un analizador por nombre
    DELETE /api/analyzers/:name     elimina un analizador
    POST   /api/evaluate            evalúa una cadena con un analizador
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

/* Agrupa errores léxicos consecutivos de "Carácter no reconocido" en la misma línea
 * en un solo error para evitar ruido visual.
 */
function groupLexicalErrors(errors) {
    const result = [];
    let i = 0;
    while (i < errors.length) {
        const e = errors[i];
        const charMatch = e.type === 'lexical' && e.message.match(/^Carácter no reconocido: "([^"]+)"/);
        if (charMatch) {
            let chars = charMatch[1];
            let lastCol = e.col;
            let j = i + 1;
            while (j < errors.length) {
                const next = errors[j];
                const nextMatch = next.type === 'lexical' && next.message.match(/^Carácter no reconocido: "([^"]+)"/);
                if (nextMatch && next.line === e.line && next.col === lastCol + 1) {
                    chars += nextMatch[1];
                    lastCol = next.col;
                    j++;
                } else {
                    break;
                }
            }
            result.push(j > i + 1
                ? { ...e, message: `Carácter(es) no reconocido(s): "${chars}"` }
                : e
            );
            i = j;
        } else {
            result.push(e);
            i++;
        }
    }
    return result;
}

// Mapa de tokens internos de jison a nombres legibles para el usuario
const TOKEN_NAMES = {
    WISON_OPEN:        '"¿"',
    WISON_CLOSE:       '"?Wison"',
    WISON:             '"Wison"',
    WISON_OPEN_JOINED: '"Wison¿"',
    LEX_OPEN:          '"{:"',
    LEX_CLOSE:         '":}"',
    SYNTAX_OPEN:       '"{{:"',
    SYNTAX_CLOSE:      '":}}"',
    LEX:               '"Lex"',
    SYNTAX:            '"Syntax"',
    NO_TERMINAL_KW:    '"No_Terminal"',
    TERMINAL_KW:       '"Terminal"',
    INITIAL_SIM_KW:    '"Initial_Sim"',
    ARROW:             '"<-"',
    PROD_ARROW:        '"<="',
    TERMINAL_NAME:     'nombre de terminal ($_...)',
    NT_NAME:           'nombre de no-terminal (%_...)',
    SEMICOLON:         '";"',
    PIPE:              '"|"',
    LITERAL:           "literal entre comillas simples",
    RANGE_ALPHA:       '"[aA-zZ]"',
    RANGE_DIGIT:       '"[0-9]"',
    EOF:               'fin de archivo',
    $end:              'fin de archivo',
};

function friendlyParseError(hash) {
    const line = hash?.loc?.first_line ?? null;
    const col  = hash?.loc?.first_column ?? null;

    const found = hash?.text
        ? `"${hash.text}"`
        : (hash?.token ? (TOKEN_NAMES[hash.token] || `"${hash.token}"`) : 'token desconocido');

    const expected = Array.isArray(hash?.expected) && hash.expected.length > 0
        ? hash.expected
              .map(t => TOKEN_NAMES[t.replace(/^'|'$/g, '')] || t)
              .join(' o ')
        : null;

    const msg = expected
        ? `Error sintáctico en línea ${line}: se encontró ${found}, pero se esperaba ${expected}.`
        : `Error sintáctico en línea ${line}: token inesperado ${found}.`;

    return { type: 'syntactic', message: msg, line, col };
}

// Parseo de código Wison
function parseWison(source) {
    const errorsRef = [];
    parser.yy.errors = errorsRef;

    let lastErrorHash = null;
    parser.yy.parseError = function(_msg, hash) {
        lastErrorHash = hash;
        // No lanzar - dejar que jison intente recuperarse
    };

    try {
        const ast = parser.parse(source);
        // ast.errors === parser.yy.errors === errorsRef (misma referencia), usar solo uno
        if (errorsRef.length > 0) {
            return { ok: false, recovered: true, errors: groupLexicalErrors(errorsRef), ast };
        }
        return { ok: true, ast };
    } catch (e) {
        const friendly = friendlyParseError(e.hash || lastErrorHash);
        return {
            ok:        false,
            recovered: false,
            errors:    errorsRef.length > 0
                       ? groupLexicalErrors(errorsRef)
                       : [friendly]
        };
    }
}

// Normalizar texto copiado desde Word / PDF
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

    // Error irrecuperable: estructura Wison completamente inválida (sin AST)
    if (!parseResult.ok && !parseResult.recovered) {
        return res.status(422).json({
            ok:      false,
            stage:   'syntactic',
            errors:  parseResult.errors.length > 0
                     ? parseResult.errors
                     : [{ type: 'syntactic', message: parseResult.message, line: null, col: null }]
        });
    }

    // Etapa 2: análisis semántico + generación LL(1)
    // Se ejecuta siempre que haya AST, incluso si hubo errores léxicos/sintácticos recuperados
    const genResult = generate(parseResult.ast, name.trim());
    const parseErrors = parseResult.ok ? [] : parseResult.errors;

    if (!genResult.ok) {
        return res.status(422).json({
            ok:            false,
            stage:         parseErrors.length > 0 ? 'mixed' : 'semantic',
            errors:        [...parseErrors, ...genResult.errors],
            warnings:      genResult.warnings,
            leftRecursion: genResult.leftRecursion || [],
            conflicts:     genResult.conflicts || []
        });
    }

    // Si hubo errores léxicos/sintácticos recuperados pero la semántica pasó, reportar igual
    if (parseErrors.length > 0) {
        return res.status(422).json({
            ok:       false,
            stage:    'syntactic',
            errors:   parseErrors,
            warnings: genResult.ok ? (genResult.entry?.warnings || []) : []
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