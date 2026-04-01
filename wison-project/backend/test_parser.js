/**
 * test_parser.js
 * Ejecutar con:  node test_parser.js
 *
 * Carga el parser compilado y prueba varios casos:
 *   - Gramáticas válidas
 *   - Errores léxicos
 *   - Errores sintácticos
 */

const fs = require('fs');

// ── Cargar el parser generado por Jison ─────────────────────────────────────
const parserSrc = fs.readFileSync('./grammar/wison_parser.js', 'utf8');
const m = { exports: {} };
new Function('module', 'exports', 'require', parserSrc)(m, m.exports, require);
const { parser } = m.exports;

// ── Wrapper con manejo de errores claro ─────────────────────────────────────
function parseWison(source) {
    try {
        return { ok: true, ast: parser.parse(source) };
    } catch (e) {
        const msg = e.message || String(e);
        const isSyntax = msg.includes('Parse error') || msg.includes('Expecting');
        return {
            ok: false,
            type: isSyntax ? 'SINTÁCTICO' : 'LÉXICO',
            message: msg,
            line: e.hash?.loc?.first_line ?? '?'
        };
    }
}

// ── Utilidad para imprimir resultados ───────────────────────────────────────
function printAST(ast) {
    console.log('  Terminales:');
    ast.terminals.forEach(t =>
        console.log(`    ${t.name.padEnd(18)} <- "${t.pattern}"  [${t.patternType}]`)
    );
    console.log('  No terminales:', ast.nonTerminals.map(n => n.name).join(', '));
    console.log('  Símbolo inicial:', ast.initialSymbol);
    console.log('  Producciones:');
    ast.productions.forEach(p =>
        p.alternatives.forEach((alt, i) =>
            console.log(`    ${i === 0 ? p.head + ' ->' : '         |'}  ${alt.map(s => s.name).join(' ')}`)
        )
    );
}

let passed = 0, failed = 0;

function test(name, input, expectOk) {
    const result = parseWison(input);
    const ok = result.ok === expectOk;
    const icon = ok ? '✓' : '✗';
    console.log(`\n${icon} TEST: ${name}`);
    if (ok) {
        passed++;
        if (result.ok) printAST(result.ast);
        else console.log(`  Error detectado correctamente → [${result.type}] línea ${result.line}: ${result.message.split('\n')[0]}`);
    } else {
        failed++;
        if (result.ok) {
            console.log('  Se esperaba un error pero el parse fue exitoso');
            printAST(result.ast);
        } else {
            console.log(`  ERROR INESPERADO [${result.type}] línea ${result.line}: ${result.message.split('\n')[0]}`);
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
//  CASOS VÁLIDOS
// ════════════════════════════════════════════════════════════════════════════

test('Gramática mínima (un terminal, un NT, una producción)', `
Wison ¿
Lex {:
    Terminal $_A <- 'a' ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_A ;
:}}
?Wison
`, true);

// ─────────────────────────────────────────────────────────────────────────────

test('Ejemplo completo del PDF', `
#Esto es un comentario de línea
Wison ¿
Lex {:
    /**
      Comentario de bloque
    */
    Terminal $_Una_A     <- 'a' ;
    Terminal $_Mas       <- '+' ;
    Terminal $_Punto     <- '.' ;
    Terminal $_P_Ab      <- '(' ;
    Terminal $_P_Ce      <- ')' ;
    Terminal $_FIN       <- 'FIN' ;
    Terminal $_Letra     <- [aA-zZ] ;
    Terminal $_NUMERO    <- [0-9] ;
    Terminal $_NUMEROS   <- [0-9]* ;
    Terminal $_NUMEROS_2 <- [0-9]+ ;
    Terminal $_NUMEROS_3 <- [0-9]? ;
    Terminal $_Decimal   <- ([0-9]*)($_Punto)($_NUMEROS_2) ;
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
?Wison
`, true);

// ─────────────────────────────────────────────────────────────────────────────

test('Producción con múltiples alternativas (|)', `
Wison ¿
Lex {:
    Terminal $_X <- 'x' ;
    Terminal $_Y <- 'y' ;
    Terminal $_Z <- 'z' ;
:}
Syntax {{:
    No_Terminal %_S;
    No_Terminal %_A;
    Initial_Sim %_S ;
    %_S <= %_A $_X ;
    %_A <= $_X | $_Y | $_Z ;
:}}
?Wison
`, true);

// ─────────────────────────────────────────────────────────────────────────────

test('Operadores unarios *, +, ?', `
Wison ¿
Lex {:
    Terminal $_Dig   <- [0-9] ;
    Terminal $_Letra <- [aA-zZ] ;
    Terminal $_Digs  <- [0-9]* ;
    Terminal $_Digs1 <- [0-9]+ ;
    Terminal $_DigOp <- [0-9]? ;
    Terminal $_Dec   <- ([0-9]*)([0-9]+) ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_Dec ;
:}}
?Wison
`, true);

// ─────────────────────────────────────────────────────────────────────────────

test('Solo comentarios en el Lex, sin romper el parser', `
Wison ¿
Lex {:
    # esto es ignorado
    /** esto
        también */
    Terminal $_T <- 'tok' ;
    # otro comentario final
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_T ;
:}}
?Wison
`, true);

// ════════════════════════════════════════════════════════════════════════════
//  CASOS DE ERROR
// ════════════════════════════════════════════════════════════════════════════

test('Error: falta la flecha <- en Terminal', `
Wison ¿
Lex {:
    Terminal $_A 'a' ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_A ;
:}}
?Wison
`, false);

// ─────────────────────────────────────────────────────────────────────────────

test('Error: falta punto y coma ; en terminal', `
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
?Wison
`, false);

// ─────────────────────────────────────────────────────────────────────────────

test('Error: falta Initial_Sim', `
Wison ¿
Lex {:
    Terminal $_A <- 'a' ;
:}
Syntax {{:
    No_Terminal %_S;
    %_S <= $_A ;
:}}
?Wison
`, false);

// ─────────────────────────────────────────────────────────────────────────────

test('Error: cierre incorrecto del bloque Syntax (usa :} en vez de :}})', `
Wison ¿
Lex {:
    Terminal $_A <- 'a' ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_A ;
:}
?Wison
`, false);

// ─────────────────────────────────────────────────────────────────────────────

test('Error: producción sin <= ', `
Wison ¿
Lex {:
    Terminal $_A <- 'a' ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S $_A ;
:}}
?Wison
`, false);

// ─────────────────────────────────────────────────────────────────────────────

test('Error: bloque Wison no cerrado con ?Wison', `
Wison ¿
Lex {:
    Terminal $_A <- 'a' ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_A ;
:}}
`, false);

// ════════════════════════════════════════════════════════════════════════════

console.log(`\n${'─'.repeat(50)}`);
console.log(`Resultado: ${passed} pasaron  |  ${failed} fallaron  |  ${passed+failed} total`);
console.log('─'.repeat(50));
