const fs = require('fs');
const { generate, computeFirst, computeFollow, detectLeftRecursion, EPSILON, EOF_SYM } = require('./src/ll-generator.js');

// ── Cargar parser ──────────────────────────────────────────────────────────
const m = { exports: {} };
new Function('module','exports','require', fs.readFileSync('./grammar/wison_parser.js','utf8'))(m,m.exports,require);
const { parser } = m.exports;

function parse(src) {
    parser.yy.parseError = (msg) => { throw new Error(msg); };
    return parser.parse(src);
}

let passed = 0, failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`✓  ${name}`);
        passed++;
    } catch(e) {
        console.log(`✗  ${name}`);
        console.log(`   ${e.message}`);
        failed++;
    }
}
function eq(a, b) { if (a !== b) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function has(set, val) { if (!set.has(val)) throw new Error(`Expected "${val}" in set [${[...set].join(', ')}]`); }
function hasNot(set, val) { if (set.has(val)) throw new Error(`Did NOT expect "${val}" in set [${[...set].join(', ')}]`); }

// ── Gramática simple para tests básicos ───────────────────────────────────
// S → A b
// A → a | ε
const simpleWison = `
Wison ¿
Lex {:
    Terminal $_a <- 'a' ;
    Terminal $_b <- 'b' ;
    Terminal $_c <- 'c' ;
:}
Syntax {{:
    No_Terminal %_S;
    No_Terminal %_A;
    Initial_Sim %_S ;
    %_S <= %_A $_b ;
    %_A <= $_a | ;
:}}
?Wison`;

// ── Gramática del PDF (con recursión izquierda) ────────────────────────────
const pdfWison = `
Wison ¿
Lex {:
    Terminal $_Una_A <- 'a' ;
    Terminal $_Mas   <- '+' ;
    Terminal $_P_Ab  <- '(' ;
    Terminal $_P_Ce  <- ')' ;
    Terminal $_FIN   <- 'FIN' ;
:}
Syntax {{:
    No_Terminal %_Prod_A;
    No_Terminal %_Prod_B;
    No_Terminal %_Prod_C;
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S      <= %_Prod_A $_FIN ;
    %_Prod_A <= $_P_Ab %_Prod_B $_P_Ce ;
    %_Prod_B <= %_Prod_B %_Prod_C | %_Prod_C ;
    %_Prod_C <= $_Una_A $_Mas $_Una_A ;
:}}
?Wison`;

// ── Gramática LL(1) correcta (expresiones simples sin recursión izq.) ──────
// E  → T E'
// E' → + T E' | ε
// T  → F T'
// T' → * F T' | ε
// F  → ( E ) | id
const exprWison = `
Wison ¿
Lex {:
    Terminal $_plus  <- '+' ;
    Terminal $_star  <- '*' ;
    Terminal $_lparen <- '(' ;
    Terminal $_rparen <- ')' ;
    Terminal $_id    <- 'id' ;
:}
Syntax {{:
    No_Terminal %_E;
    No_Terminal %_Ep;
    No_Terminal %_T;
    No_Terminal %_Tp;
    No_Terminal %_F;
    Initial_Sim %_E ;
    %_E  <= %_T %_Ep ;
    %_Ep <= $_plus %_T %_Ep | ;
    %_T  <= %_F %_Tp ;
    %_Tp <= $_star %_F %_Tp | ;
    %_F  <= $_lparen %_E $_rparen | $_id ;
:}}
?Wison`;

console.log('\n══ 1. Validación semántica ══\n');

test('NT no declarado es detectado', () => {
    const ast = parse(`
Wison ¿
Lex {: Terminal $_A <- 'a' ; :}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= %_NoDeclarado $_A ;
:}}
?Wison`);
    const r = generate(ast, 'test');
    eq(r.ok, false);
    eq(r.type, 'semantic');
    if (!r.errors[0].includes('NoDeclarado')) throw new Error('Mensaje no menciona el NT: ' + r.errors[0]);
});

test('Terminal referenciado sin declarar es detectado', () => {
    const ast = parse(`
Wison ¿
Lex {: Terminal $_A <- 'a' ; :}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_NoDeclarado ;
:}}
?Wison`);
    const r = generate(ast, 'test');
    eq(r.ok, false);
});

test('Initial_Sim no declarado como NT es detectado', () => {
    const ast = parse(`
Wison ¿
Lex {: Terminal $_A <- 'a' ; :}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_NoExiste ;
    %_S <= $_A ;
:}}
?Wison`);
    const r = generate(ast, 'test');
    eq(r.ok, false);
});

console.log('\n══ 2. Resolución de referencias ══\n');

test('Referencia simple resuelta', () => {
    const ast = parse(`
Wison ¿
Lex {:
    Terminal $_Punto  <- '.' ;
    Terminal $_Decimal <- ([0-9]+)($_Punto)([0-9]+) ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_Decimal ;
:}}
?Wison`);
    const r = generate(ast, 'test');
    eq(r.ok, true);
    const dec = r.entry.terminalPatterns['$_Decimal'];
    if (dec.includes('$_Punto')) throw new Error('Referencia no resuelta: ' + dec);
    if (!dec.includes('\\.')) throw new Error('Patrón de Punto no incluido: ' + dec);
});

console.log('\n══ 3. Recursión izquierda ══\n');

test('Recursión izquierda directa detectada (ejemplo PDF)', () => {
    const ast = parse(pdfWison);
    const r = generate(ast, 'test');
    eq(r.ok, false);
    if (!r.leftRecursion || r.leftRecursion.length === 0)
        throw new Error('No detectó recursión izquierda');
    const nt = r.leftRecursion.find(x => x.nt === '%_Prod_B');
    if (!nt) throw new Error('No detectó recursión en %_Prod_B');
    console.log('   Detectado:', r.leftRecursion.map(x=>x.description).join('; '));
});

test('Gramática sin recursión pasa la etapa 3', () => {
    const ast = parse(exprWison);
    const r = generate(ast, 'test');
    // No debe fallar por recursión (puede fallar por otro motivo, pero no recursión)
    if (r.leftRecursion && r.leftRecursion.length > 0)
        throw new Error('Detectó recursión incorrectamente: ' + JSON.stringify(r.leftRecursion));
});

console.log('\n══ 4. FIRST ══\n');

test('FIRST gramática simple: FIRST(%_A) = {a, ε}', () => {
    const ast = parse(simpleWison);
    const first = computeFirst(ast);
    has(first['%_A'], '$_a');
    has(first['%_A'], EPSILON);
});

test('FIRST gramática simple: FIRST(%_S) = {a, b}', () => {
    const ast = parse(simpleWison);
    const first = computeFirst(ast);
    has(first['%_S'], '$_a');
    has(first['%_S'], '$_b');
    hasNot(first['%_S'], EPSILON);
});

test('FIRST gramática expresiones: FIRST(%_E) = {(, id}', () => {
    const ast = parse(exprWison);
    const first = computeFirst(ast);
    has(first['%_E'], '$_lparen');
    has(first['%_E'], '$_id');
    hasNot(first['%_E'], EPSILON);
});

test('FIRST gramática expresiones: FIRST(%_Ep) = {+, ε}', () => {
    const ast = parse(exprWison);
    const first = computeFirst(ast);
    has(first['%_Ep'], '$_plus');
    has(first['%_Ep'], EPSILON);
});

console.log('\n══ 5. FOLLOW ══\n');

test('FOLLOW gramática simple: FOLLOW(%_S) = {$}', () => {
    const ast = parse(simpleWison);
    const first = computeFirst(ast);
    const follow = computeFollow(ast, first);
    has(follow['%_S'], EOF_SYM);
});

test('FOLLOW gramática simple: FOLLOW(%_A) = {b}', () => {
    const ast = parse(simpleWison);
    const first = computeFirst(ast);
    const follow = computeFollow(ast, first);
    has(follow['%_A'], '$_b');
});

test('FOLLOW expresiones: FOLLOW(%_E) = {), $}', () => {
    const ast = parse(exprWison);
    const first = computeFirst(ast);
    const follow = computeFollow(ast, first);
    has(follow['%_E'], '$_rparen');
    has(follow['%_E'], EOF_SYM);
});

test('FOLLOW expresiones: FOLLOW(%_Ep) = {), $}', () => {
    const ast = parse(exprWison);
    const first = computeFirst(ast);
    const follow = computeFollow(ast, first);
    has(follow['%_Ep'], '$_rparen');
    has(follow['%_Ep'], EOF_SYM);
});

console.log('\n══ 6. Tabla LL(1) y generate() ══\n');

test('Gramática expresiones genera tabla sin conflictos', () => {
    const ast = parse(exprWison);
    const r = generate(ast, 'expr');
    eq(r.ok, true);
    // Verificar entradas clave de la tabla
    // M[E][id] = E → T E'
    const mEid = r.entry.parseTable['%_E']['$_id'];
    if (!mEid) throw new Error('M[%_E][$_id] vacío');
    eq(mEid.head, '%_E');
    // M[Ep][+] = E' → + T E'
    const mEpPlus = r.entry.parseTable['%_Ep']['$_plus'];
    if (!mEpPlus) throw new Error('M[%_Ep][$_plus] vacío');
    // M[Ep][$] = E' → ε
    const mEpEof = r.entry.parseTable['%_Ep'][EOF_SYM];
    if (!mEpEof) throw new Error('M[%_Ep][$] vacío');
    eq(mEpEof.body.length, 0); // alternativa vacía = ε
});

test('Gramática ambigua genera conflictos', () => {
    // S → A a | b A
    // A → a | ε
    // No es LL(1) - hay conflicto en M[A][a]
    const ast = parse(`
Wison ¿
Lex {: Terminal $_a <- 'a' ; Terminal $_b <- 'b' ; :}
Syntax {{:
    No_Terminal %_S;
    No_Terminal %_A;
    Initial_Sim %_S ;
    %_S <= %_A $_a | $_b %_A ;
    %_A <= $_a | ;
:}}
?Wison`);
    const r = generate(ast, 'test');
    eq(r.ok, false);
    if (!r.conflicts || r.conflicts.length === 0)
        throw new Error('No detectó conflictos');
    console.log('   Conflictos detectados:', r.conflicts.length);
});

test('generate() retorna entry con todos los campos', () => {
    const ast = parse(exprWison);
    const r = generate(ast, 'mis-expresiones');
    eq(r.ok, true);
    eq(r.entry.name, 'mis-expresiones');
    if (!r.entry.grammar)         throw new Error('Falta grammar');
    if (!r.entry.terminalPatterns) throw new Error('Falta terminalPatterns');
    if (!r.entry.firstSets)       throw new Error('Falta firstSets');
    if (!r.entry.followSets)      throw new Error('Falta followSets');
    if (!r.entry.parseTable)      throw new Error('Falta parseTable');
    if (!r.entry.createdAt)       throw new Error('Falta createdAt');
});

test('entry es serializable a JSON', () => {
    const ast = parse(exprWison);
    const r = generate(ast, 'test');
    eq(r.ok, true);
    const json = JSON.stringify(r.entry);
    const back = JSON.parse(json);
    eq(back.name, 'test');
});

console.log('\n══ 7. Impresión de conjuntos (gramática expresiones) ══\n');

const astExpr = parse(exprWison);
const rExpr = generate(astExpr, 'expr');
if (rExpr.ok) {
    console.log('FIRST:');
    for (const [k,v] of Object.entries(rExpr.entry.firstSets)) {
        if (k.startsWith('%_')) console.log(`  FIRST(${k}) = { ${v.join(', ')} }`);
    }
    console.log('\nFOLLOW:');
    for (const [k,v] of Object.entries(rExpr.entry.followSets)) {
        if (k.startsWith('%_')) console.log(`  FOLLOW(${k}) = { ${v.join(', ')} }`);
    }
    console.log('\nTabla M (entradas no vacías):');
    for (const [nt, row] of Object.entries(rExpr.entry.parseTable)) {
        for (const [term, entry] of Object.entries(row)) {
            const body = entry.body.length === 0 ? 'ε' : entry.body.map(s=>s.name).join(' ');
            console.log(`  M[${nt}][${term}] = ${nt} → ${body}`);
        }
    }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`Resultado: ${passed} pasaron  |  ${failed} fallaron  |  ${passed+failed} total`);
console.log('─'.repeat(50));
