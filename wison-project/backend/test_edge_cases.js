const fs = require('fs');
const parserSrc = fs.readFileSync('./grammar/wison_parser.js', 'utf8');
const m = { exports: {} };
new Function('module', 'exports', 'require', parserSrc)(m, m.exports, require);
const { parser } = m.exports;

function parseWison(source) {
    let captured = null;
    parser.yy.parseError = function(msg, hash) {
        captured = { type: hash?.token !== undefined ? 'SINTÁCTICO':'LÉXICO',
                     message: msg, line: hash?.loc?.first_line ?? '?',
                     expected: hash?.expected, token: hash?.token };
        throw new Error(msg);
    };
    try { return { ok: true, ast: parser.parse(source) }; }
    catch(e) { return { ok: false, ...(captured || { type:'LÉXICO', message: e.message, line:'?' }) }; }
}

let passed = 0, failed = 0;

function test(name, input, expectOk, extraCheck) {
    const result = parseWison(input);
    const ok = result.ok === expectOk;
    const icon = ok ? '✓' : '✗';
    console.log(`\n${icon} ${name}`);
    if (ok) {
        passed++;
        if (result.ok && extraCheck) extraCheck(result.ast);
        if (!result.ok) console.log(`   Error detectado → [${result.type}] línea ${result.line}: ${result.message.split('\n')[0]}`);
    } else {
        failed++;
        if (result.ok) { console.log('   Se esperaba error pero pasó'); }
        else console.log(`   ERROR INESPERADO [${result.type}] línea ${result.line}: ${result.message.split('\n')[0]}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// GRUPO A — Casos de la especificación no cubiertos en los tests previos
// ═══════════════════════════════════════════════════════════════════════
console.log('\n══ A. Casos de la especificación del lenguaje Wison ══\n');

// A1: Terminal con literal de múltiples caracteres (palabra reservada)
// El PDF dice: 'FIN' es una palabra reservada
test('A1 — Literal multi-carácter (palabra reservada)', `
Wison ¿
Lex {:
    Terminal $_FIN     <- 'FIN' ;
    Terminal $_RETURN  <- 'return' ;
    Terminal $_BEGIN   <- 'BEGIN' ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_FIN ;
:}}
?Wison
`, true, ast => {
    console.log('   Terminales multi-char:', ast.terminals.map(t => `${t.name}="${t.pattern}"`).join(', '));
});

// A2: Terminal con un solo carácter especial escapado
// El PDF muestra: '+' '.' '(' ')' como casos válidos
test('A2 — Caracteres especiales de regex como literales', `
Wison ¿
Lex {:
    Terminal $_Punto   <- '.' ;
    Terminal $_Mas     <- '+' ;
    Terminal $_Menos   <- '-' ;
    Terminal $_Mul     <- '*' ;
    Terminal $_PAb     <- '(' ;
    Terminal $_PCe     <- ')' ;
    Terminal $_CAb     <- '[' ;
    Terminal $_CCe     <- ']' ;
    Terminal $_LLAb    <- '{' ;
    Terminal $_LLCe    <- '}' ;
    Terminal $_Barra   <- '/' ;
    Terminal $_BSlash  <- '\' ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_Punto ;
:}}
?Wison
`, true, ast => {
    console.log('   Patrones escapados:');
    ast.terminals.forEach(t => console.log(`     ${t.name.padEnd(14)} -> "${t.pattern}"`));
});

// A3: Terminal combinado con referencia a otro terminal (concatenación de referencias)
// El PDF muestra: Terminal $_Decimal <- ([0-9]*)($_Punto)($_NUMEROS_2)
// Aquí probamos 3 niveles de referencia encadenados
test('A3 — Terminal combinado con 3 referencias concatenadas', `
Wison ¿
Lex {:
    Terminal $_Entero  <- [0-9]+ ;
    Terminal $_Punto   <- '.' ;
    Terminal $_Decimal <- ([0-9]+)($_Punto)([0-9]+) ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_Decimal ;
:}}
?Wison
`, true, ast => {
    const dec = ast.terminals.find(t => t.name === '$_Decimal');
    console.log(`   $_Decimal pattern: "${dec.pattern}" [${dec.patternType}]`);
});

// A4: Producción con épsilon (alternativa vacía)
// La especificación dice que se puede tener alternativas vacías (ε)
// Esto se necesita para gramáticas LL donde A -> B | ε
test('A4 — Producción con alternativa vacía (épsilon)', `
Wison ¿
Lex {:
    Terminal $_A <- 'a' ;
    Terminal $_B <- 'b' ;
:}
Syntax {{:
    No_Terminal %_S;
    No_Terminal %_Opt;
    Initial_Sim %_S ;
    %_S   <= $_A %_Opt $_B ;
    %_Opt <= $_A | ;
:}}
?Wison
`, true, ast => {
    const opt = ast.productions.find(p => p.head === '%_Opt');
    console.log(`   %_Opt alternativas: ${opt.alternatives.length}`);
    opt.alternatives.forEach((alt, i) =>
        console.log(`     [${i}]: ${alt.length === 0 ? 'ε (vacía)' : alt.map(s=>s.name).join(' ')}`)
    );
});

// A5: Múltiples producciones para el mismo no terminal
// El PDF no lo muestra explícito, pero es válido en CFG:
// %_A <= %_B ; y luego %_A <= %_C ; son dos reglas separadas del mismo NT
test('A5 — Mismo NT con producciones en líneas separadas', `
Wison ¿
Lex {:
    Terminal $_x <- 'x' ;
    Terminal $_y <- 'y' ;
:}
Syntax {{:
    No_Terminal %_S;
    No_Terminal %_A;
    Initial_Sim %_S ;
    %_S <= %_A ;
    %_A <= $_x ;
    %_A <= $_y ;
:}}
?Wison
`, true, ast => {
    const prods = ast.productions.filter(p => p.head === '%_A');
    console.log(`   Producciones de %_A: ${prods.length} reglas separadas`);
    prods.forEach((p,i) => console.log(`     Regla ${i+1}: ${p.alternatives.map(a=>a.map(s=>s.name).join(' ')).join(' | ')}`));
});

// A6: No terminal usado antes de su declaración (debe ser error semántico,
// pero el parser Jison solo hace sintáctico — verificar qué pasa)
test('A6 — NT usado en producción sin haber sido declarado', `
Wison ¿
Lex {:
    Terminal $_A <- 'a' ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= %_NoDeclarado $_A ;
:}}
?Wison
`, true, ast => {
    // El parser Jison acepta esto — la validación semántica va en ll-generator
    console.log('   El parser acepta NT no declarado (validación semántica pendiente en ll-generator)');
    const prod = ast.productions[0];
    console.log(`   Producción: ${prod.head} -> ${prod.alternatives[0].map(s=>`${s.name}[${s.type}]`).join(' ')}`);
});

// A7: Producción encadenada larga (más de 5 símbolos en una alternativa)
test('A7 — Alternativa con muchos símbolos encadenados', `
Wison ¿
Lex {:
    Terminal $_a <- 'a' ;
    Terminal $_b <- 'b' ;
    Terminal $_c <- 'c' ;
    Terminal $_d <- 'd' ;
    Terminal $_e <- 'e' ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_a $_b $_c $_d $_e $_a $_b $_c ;
:}}
?Wison
`, true, ast => {
    const alt = ast.productions[0].alternatives[0];
    console.log(`   Símbolos en la alternativa: ${alt.length}`);
});

// A8: Bloque Lex completamente vacío (sin terminales declarados)
// Raro pero no lo prohíbe la gramática
test('A8 — Bloque Lex vacío (sin terminales)', `
Wison ¿
Lex {:
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= %_S ;
:}}
?Wison
`, true, ast => {
    console.log(`   Terminales: ${ast.terminals.length} (ninguno)`);
});

// A9: Operador ? aplicado a un rango (no solo a literales)
test('A9 — Operador ? sobre rango [aA-zZ]', `
Wison ¿
Lex {:
    Terminal $_LetraOpt <- [aA-zZ]? ;
    Terminal $_DigOpt   <- [0-9]? ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_LetraOpt ;
:}}
?Wison
`, true, ast => {
    ast.terminals.forEach(t => console.log(`   ${t.name} -> "${t.pattern}" [${t.patternType}]`));
});

// A10: Comentario de bloque dentro del bloque Syntax
test('A10 — Comentario de bloque dentro de Syntax', `
Wison ¿
Lex {:
    Terminal $_A <- 'a' ;
:}
Syntax {{:
    /** Este comentario está dentro del bloque Syntax */
    No_Terminal %_S;
    # Y este es de línea
    Initial_Sim %_S ;
    %_S <= $_A ; /** comentario al final de producción */
:}}
?Wison
`, true, ast => {
    console.log(`   Comentarios ignorados correctamente. Producciones: ${ast.productions.length}`);
});

// ═══════════════════════════════════════════════════════════════════════
// GRUPO B — Errores que deben detectarse según las reglas del PDF
// ═══════════════════════════════════════════════════════════════════════
console.log('\n\n══ B. Errores según reglas del PDF ══\n');

// B1: Nombre de terminal sin prefijo $_
test('B1 — Terminal sin prefijo $_ (nombre inválido)', `
Wison ¿
Lex {:
    Terminal MiTerminal <- 'a' ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= MiTerminal ;
:}}
?Wison
`, false);

// B2: Nombre de no terminal sin prefijo %_
test('B2 — No terminal sin prefijo %_ en declaración', `
Wison ¿
Lex {:
    Terminal $_A <- 'a' ;
:}
Syntax {{:
    No_Terminal S;
    Initial_Sim S ;
    S <= $_A ;
:}}
?Wison
`, false);

// B3: Initial_Sim declarado dos veces
test('B3 — Initial_Sim duplicado', `
Wison ¿
Lex {:
    Terminal $_A <- 'a' ;
:}
Syntax {{:
    No_Terminal %_S;
    No_Terminal %_B;
    Initial_Sim %_S ;
    Initial_Sim %_B ;
    %_S <= $_A ;
    %_B <= $_A ;
:}}
?Wison
`, false);

// B4: Bloque Lex con palabra clave Syntax mal escrita (case sensitive)
test('B4 — "syntax" en minúscula (case sensitive)', `
Wison ¿
Lex {:
    Terminal $_A <- 'a' ;
:}
syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_A ;
:}}
?Wison
`, false);

// B5: "terminal" en minúscula
test('B5 — "terminal" en minúscula (case sensitive)', `
Wison ¿
Lex {:
    terminal $_A <- 'a' ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_A ;
:}}
?Wison
`, false);

// B6: Rango inventado (no es [aA-zZ] ni [0-9])
test('B6 — Rango no permitido [A-Z] (solo se aceptan [aA-zZ] y [0-9])', `
Wison ¿
Lex {:
    Terminal $_Letra <- [A-Z] ;
:}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= $_Letra ;
:}}
?Wison
`, false);

// ─────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`Resultado: ${passed} pasaron  |  ${failed} fallaron  |  ${passed+failed} total`);
console.log('─'.repeat(55));
