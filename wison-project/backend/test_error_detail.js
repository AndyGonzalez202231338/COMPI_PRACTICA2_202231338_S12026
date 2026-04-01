const fs = require('fs');
const parserSrc = fs.readFileSync('./grammar/wison_parser.js', 'utf8');
const m = { exports: {} };
new Function('module', 'exports', 'require', parserSrc)(m, m.exports, require);
const { parser } = m.exports;

// ── Wrapper mejorado con parseError inyectado ────────────────────────────────
function parseWison(source) {
    let captured = null;

    // Inyectamos parseError tanto en parser como en lexer
    // para capturar línea, columna y tipo real del error
    parser.yy.parseError = function(msg, hash) {
        captured = {
            type:    hash && hash.token !== undefined ? 'SINTÁCTICO' : 'LÉXICO',
            message: msg,
            line:    hash && hash.loc ? hash.loc.first_line : '?',
            col:     hash && hash.loc ? hash.loc.first_column : '?',
            token:   hash ? hash.token : null,
            expected: hash ? hash.expected : null
        };
        throw new Error(msg);
    };

    try {
        return { ok: true, ast: parser.parse(source) };
    } catch(e) {
        if (captured) {
            return { ok: false, ...captured };
        }
        // fallback si el error escapó sin capturar
        return {
            ok:      false,
            type:    'LÉXICO',
            message: e.message,
            line:    '?',
            col:     '?'
        };
    }
}

// ── Casos de error con detalle esperado ──────────────────────────────────────
const errorCases = [
    {
        name: 'Falta <- en Terminal',
        input: `Wison ¿ Lex {: Terminal $_A 'a' ; :} Syntax {{: No_Terminal %_S; Initial_Sim %_S ; %_S <= $_A ; :}} ?Wison`
    },
    {
        name: 'Falta ; al final de terminal',
        input: `
Wison ¿
Lex {:
    Terminal $_A <- 'a'
    Terminal $_B <- 'b' ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_A ;
:}}
?Wison`
    },
    {
        name: 'Falta Initial_Sim',
        input: `
Wison ¿
Lex {: Terminal $_A <- 'a' ; :}
Syntax {{:
    No_Terminal %_S;
    %_S <= $_A ;
:}}
?Wison`
    },
    {
        name: 'Cierre Syntax con :} en vez de :}}',
        input: `
Wison ¿
Lex {: Terminal $_A <- 'a' ; :}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_A ;
:}
?Wison`
    },
    {
        name: 'Producción sin <=',
        input: `
Wison ¿
Lex {: Terminal $_A <- 'a' ; :}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S $_A ;
:}}
?Wison`
    },
    {
        name: 'Sin cierre ?Wison (EOF inesperado)',
        input: `
Wison ¿
Lex {: Terminal $_A <- 'a' ; :}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_A ;
:}}`
    }
];

console.log('═══ DETALLE DE ERRORES DETECTADOS ═══\n');
errorCases.forEach(c => {
    const r = parseWison(c.input);
    if (!r.ok) {
        console.log(`[${r.type}] ${c.name}`);
        console.log(`  Línea   : ${r.line}   Columna: ${r.col}`);
        if (r.expected) console.log(`  Esperaba: ${r.expected.join(' | ')}`);
        if (r.token)    console.log(`  Encontró: ${r.token}`);
        console.log(`  Mensaje : ${r.message.split('\n')[0]}`);
        console.log();
    } else {
        console.log(`[ERROR] Se esperaba fallo en: ${c.name}`);
    }
});
