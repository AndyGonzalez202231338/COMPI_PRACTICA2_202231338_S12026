/* 
   Analiza una cadena de entrada usando la tabla LL(1) generada
   por ll-generator.js y construye el árbol de derivación.

   Pipeline:
     1. Tokenizar la entrada con los patrones del entry
     2. Analizar con el algoritmo LL(1) (pila + tabla)
     3. Construir árbol de derivación durante el análisis
     4. Retornar EvalResult con árbol o errores
*/

'use strict';
const EOF_SYM = '$';

class TreeNode {
    constructor(label, isTerminal = false, lexeme = null) {
        this.label      = label;       // nombre del símbolo: %_E, $_id, ε
        this.isTerminal = isTerminal;  // true = hoja terminal
        this.lexeme     = lexeme;      // texto real del token si es terminal
        this.children   = [];
        this.parent     = null;
    }

    addChild(node) {
        node.parent = this;
        this.children.push(node);
        return node;
    }

    toJSON() {
        return {
            label:      this.label,
            lexeme:     this.lexeme,
            isTerminal: this.isTerminal,
            children:   this.children.map(c => c.toJSON())
        };
    }
}

/* 
 * Implementa la coincidencia de patrones carácter a carácter
 * usando un autómata finito no determinista.
 */

/**
 * matchNFA(ast, input, pos)
 *
 * Dado el AST estructurado de un patrón terminal, intenta hacer
 * coincidir el patrón con la cadena de entrada a partir de `pos`.
 *
 * Retorna un Set<number> con todas las posiciones de fin posibles
 * (puede haber varias debido a *, +, ?).
 * El conjunto vacío indica que no hubo coincidencia.
 *
 * Operaciones soportadas:
 *   lit     secuencia literal de caracteres
 *   range   clase de caracteres por rangos de códigos Unicode
 *   concat  concatenación (izquierda seguida de derecha)
 *   star    cero o más repeticiones (BFS para evitar recursión infinita)
 *   plus    una o más repeticiones
 *   opt     cero o una repetición
 */
function matchNFA(ast, input, pos) {
    if (!ast) return new Set();

    switch (ast.op) {

        case 'lit': {
            // Coincidencia carácter a carácter con el valor literal
            const val = ast.value;
            let p = pos;
            for (let i = 0; i < val.length; i++) {
                if (p >= input.length || input[p] !== val[i]) return new Set();
                p++;
            }
            return new Set([p]);
        }

        case 'range': {
            // Un carácter cuyo código Unicode esté dentro de algún rango
            if (pos >= input.length) return new Set();
            const code = input.codePointAt(pos);
            for (const { from, to } of ast.ranges) {
                if (code >= from && code <= to) return new Set([pos + 1]);
            }
            return new Set();
        }

        case 'concat': {
            // Izquierda seguida de derecha
            const afterLeft = matchNFA(ast.left, input, pos);
            const result = new Set();
            for (const p of afterLeft) {
                for (const q of matchNFA(ast.right, input, p)) result.add(q);
            }
            return result;
        }

        case 'star': {
            // Cero o más: BFS sobre posiciones alcanzables
            // (evita recursión infinita en ciclos ε)
            const visited  = new Set([pos]);
            const result   = new Set([pos]);   // cero repeticiones siempre válido
            let   frontier = [pos];
            while (frontier.length > 0) {
                const next = [];
                for (const p of frontier) {
                    for (const q of matchNFA(ast.sub, input, p)) {
                        if (!visited.has(q)) {
                            visited.add(q);
                            result.add(q);
                            next.push(q);
                        }
                    }
                }
                frontier = next;
            }
            return result;
        }

        case 'plus': {
            // Una o más: al menos una coincidencia del sub, luego star
            const afterFirst = matchNFA(ast.sub, input, pos);
            const result = new Set();
            for (const p of afterFirst) {
                for (const q of matchNFA({ op: 'star', sub: ast.sub }, input, p)) result.add(q);
            }
            return result;
        }

        case 'opt': {
            // Cero o una: la posición actual siempre es válida
            const result = new Set([pos]);
            for (const q of matchNFA(ast.sub, input, pos)) result.add(q);
            return result;
        }

        default:
            return new Set();
    }
}

/**
 * Detecta espacios en blanco ASCII y Unicode
 */
function isWhitespace(ch) {
    const c = ch.charCodeAt(0);
    return (
        (c >= 0x0009 && c <= 0x000D) ||   // \t \n \v \f \r
        c === 0x0020 ||                    // espacio normal
        c === 0x00A0 ||                    // non-breaking space (Google Docs)
        c === 0x1680 ||                    // Ogham space
        (c >= 0x2000 && c <= 0x200B) ||   // En Quad … Zero-Width Space
        c === 0x202F ||                    // narrow no-break space
        c === 0x205F ||                    // medium mathematical space
        c === 0x3000 ||                    // ideographic space
        c === 0xFEFF                       // BOM / zero-width no-break space
    );
}

/**
 * tokenize(input, terminalAsts)
 *
 * Convierte la cadena de entrada en un array de tokens usando los
 * ASTs del NFA generados desde el bloque Lex del lenguaje Wison.
 *
 * Estrategia: en cada posición se prueban todos los patrones en el
 * orden en que fueron declarados y se toma la coincidencia más larga
 * (longest match). En caso de empate de longitud gana el primero
 * (prioridad por orden de declaración — permite que palabras reservadas
 * tengan precedencia sobre identificadores genéricos).
 *
 * Retorna { tokens, errors }
 */
function tokenize(input, terminalAsts) {
    const tokens = [];
    const errors = [];
    let pos  = 0;
    let line = 1;
    let col  = 1;

    // Avanzar pos/line/col n caracteres
    function advance(n) {
        for (let i = 0; i < n; i++) {
            if (input[pos] === '\n') { line++; col = 1; }
            else { col++; }
            pos++;
        }
    }

    // Pares [nombre, ast] en el orden de declaración original
    const entries = Object.entries(terminalAsts).filter(([, ast]) => ast !== null);

    while (pos < input.length) {
        // Saltar espacios en blanco carácter a carácter
        if (isWhitespace(input[pos])) { advance(1); continue; }

        let bestName = null;
        let bestLen  = 0;

        for (const [name, ast] of entries) {
            // Simular el NFA y obtener todas las posiciones de fin posibles
            const endPositions = matchNFA(ast, input, pos);
            for (const endPos of endPositions) {
                const len = endPos - pos;
                if (len > bestLen) {   // longest match; empate primer declarado
                    bestLen  = len;
                    bestName = name;
                }
            }
        }

        if (bestLen > 0) {
            tokens.push({ name: bestName, lexeme: input.slice(pos, pos + bestLen), pos, line, col });
            advance(bestLen);
        } else {
            // Carácter no reconocido por ningún patrón
            errors.push({
                type:    'lexical',
                message: `Carácter no reconocido: "${input[pos]}"`,
                pos, line, col,
                char:    input[pos]
            });
            advance(1);
        }
    }

    // Token de fin de cadena
    tokens.push({ name: EOF_SYM, lexeme: EOF_SYM, pos, line, col });

    return { tokens, errors };
}

/**
 * analyze(tokens, parseTable, initialSymbol)
 *
 * Algoritmo LL(1) clásico con pila.
 * Cada entrada de la pila es { symbol, node } donde node es el TreeNode
 * correspondiente en el árbol de derivación.
 *
 * Retorna:
 *   { accepted, root, steps, errors }
 *
 *   steps: registro de cada acción para depuración/visualización
 *   errors: errores sintácticos con posición
 */
function analyze(tokens, parseTable, initialSymbol) {
    const steps  = [];
    const errors = [];

    // Raíz del árbol
    const root = new TreeNode(initialSymbol, false);

    // Pila: cada elemento es { symbol: string, node: TreeNode }
    const stack = [
        { symbol: EOF_SYM,      node: null },
        { symbol: initialSymbol, node: root }
    ];

    let tokenIndex = 0;

    function currentToken() {
        return tokens[Math.min(tokenIndex, tokens.length - 1)];
    }

    function recordStep(action, detail) {
        steps.push({
            action,
            detail,
            stackSnapshot: stack.slice().reverse().map(e => e.symbol),
            inputSnapshot: tokens.slice(tokenIndex).map(t => t.name)
        });
    }

    while (stack.length > 0) {
        const top    = stack[stack.length - 1];
        const token  = currentToken();
        const tokName = token.name;

        // Caso 1: cima = $ 
        if (top.symbol === EOF_SYM) {
            if (tokName === EOF_SYM) {
                const clean = errors.length === 0;
                recordStep(clean ? 'ACCEPT' : 'REJECT', clean ? 'Cadena aceptada' : 'Cadena rechazada (hubo errores)');
                return { accepted: clean, root: clean ? root : null, steps, errors };
            } else {
                // Tokens sobrantes después de reconocer la cadena completa
                const err = {
                    type:    'syntactic',
                    message: `Tokens inesperados al final: "${tokName}" ("${tokens[tokenIndex].lexeme}")`,
                    pos:     tokens[tokenIndex].pos,
                    found:   tokName
                };
                errors.push(err);
                recordStep('ERROR', err.message);
                return { accepted: false, root: null, steps, errors };
            }
        }

        // Caso 2: cima es terminal
        if (top.symbol !== EOF_SYM && isTerminal(top.symbol)) {
            if (top.symbol === tokName) {
                // Coincidencia: consumir token
                top.node.lexeme = token.lexeme;
                recordStep('MATCH', `Coincide "${tokName}" = "${token.lexeme}"`);
                stack.pop();
                tokenIndex++;
            } else {
                // Error: terminal esperado no coincide
                const err = {
                    type:     'syntactic',
                    message:  `Se esperaba "${top.symbol}" pero se encontró "${tokName}" ("${token.lexeme}")`,
                    pos:      token.pos,
                    line:     token.line,
                    col:      token.col,
                    expected: top.symbol,
                    found:    tokName
                };
                errors.push(err);
                recordStep('ERROR', err.message);

                // Recuperación de error: descartar token inesperado
                if (tokenIndex < tokens.length - 1) {
                    tokenIndex++;
                } else {
                    stack.pop(); // evitar loop infinito en EOF
                }
            }
            continue;
        }

        // Caso 3: cima es no terminal
        if (isNonTerminal(top.symbol)) {
            const row = parseTable[top.symbol];
            const entry = row ? row[tokName] : undefined;

            if (entry && !entry.conflict) {
                // Expandir: reemplazar cima con la producción
                stack.pop();
                const body = entry.body; // array de símbolos [{name, type}]

                recordStep('EXPAND',
                    `${top.symbol} → ${body.length === 0 ? 'ε' : body.map(s=>s.name).join(' ')}`
                );

                if (body.length === 0) {
                    // Producción épsilon: agregar nodo ε como hijo
                    const epsNode = new TreeNode('ε', true, 'ε');
                    top.node.addChild(epsNode);
                } else {
                    // Crear nodos hijos y apilar en orden inverso
                    const childNodes = body.map(sym =>
                        top.node.addChild(
                            new TreeNode(sym.name, sym.type === 'terminal')
                        )
                    );
                    for (let i = childNodes.length - 1; i >= 0; i--) {
                        stack.push({ symbol: body[i].name, node: childNodes[i] });
                    }
                }

            } else if (entry && entry.conflict) {
                // Conflicto en tabla (no debería llegar aquí si ll-generator validó)
                const err = {
                    type:    'syntactic',
                    message: `Conflicto en tabla M["${top.symbol}"]["${tokName}"]`,
                    pos:     token.pos
                };
                errors.push(err);
                recordStep('ERROR', err.message);
                stack.pop();

            } else {
                // Celda vacía en la tabla → error sintáctico
                const validTokens = row ? Object.keys(row) : [];
                const expected = validTokens.join(', ') || 'ninguno';
                const err = {
                    type:     'syntactic',
                    message:  `Error sintáctico en "${tokName}" ("${token.lexeme}"). ` +
                              `No hay producción para M["${top.symbol}"]["${tokName}"]. ` +
                              `Tokens válidos: ${expected}`,
                    pos:      token.pos,
                    line:     token.line,
                    col:      token.col,
                    expected,
                    found:    tokName
                };
                errors.push(err);
                recordStep('ERROR', err.message);

                // Recuperación modo pánico:
                // Saltar tokens hasta encontrar uno que esté en FIRST(NT actual)
                // o en FOLLOW(NT actual) — conjunto de sincronización.
                // Si llegamos a EOF sin encontrar nada, sacar el NT de la pila.
                const syncSet = new Set(validTokens);
                syncSet.add(EOF_SYM);
                let advanced = false;
                while (tokenIndex < tokens.length - 1) {
                    tokenIndex++;
                    if (syncSet.has(tokens[tokenIndex].name)) {
                        advanced = true;
                        break;
                    }
                }
                // Si encontramos un token del sync set que está en FOLLOW (no en FIRST),
                // sacar el NT de la pila para que el padre lo maneje
                if (!advanced || !row || !row[tokens[tokenIndex].name]) {
                    stack.pop();
                }
            }
            continue;
        }

        // Caso no esperado: símbolo desconocido en la pila
        stack.pop();
    }

    // Si sale del while sin ACCEPT, la cadena fue rechazada
    return { accepted: false, root, steps, errors };
}

function isTerminal(symbol) {
    return symbol === EOF_SYM ||
           symbol.startsWith('$_') ||
           symbol === 'ε';
}

function isNonTerminal(symbol) {
    return symbol.startsWith('%_');
}

/**
 * evaluate(entry, input)
 *
 * Recibe un AnalyzerEntry (producido por ll-generator.generate)
 * y una cadena de entrada.
 *
 * Retorna EvalResult:
 * {
 *   accepted:  boolean,
 *   tree:      TreeNode | null,   // árbol de derivación si fue aceptado
 *   treeJSON:  object | null,     // versión serializable para el frontend
 *   tokens:    Token[],           // tokens reconocidos
 *   steps:     Step[],            // traza del análisis
 *   errors:    ErrorEntry[],      // errores léxicos y sintácticos
 * }
 */
function evaluate(entry, input) {
    // Etapa 1: tokenizar usando el NFA propio (terminalAsts).
    // Si el entry fue guardado antes de agregar terminalAsts (compatibilidad
    // con analizadores persistidos), se requiere recompilar el analizador.
    if (!entry.terminalAsts) {
        return {
            accepted: false,
            tree: null, treeJSON: null, tokens: [], steps: [],
            errors: [{ type: 'lexical', message: 'Este analizador fue compilado con una versión anterior. Por favor recompílalo para usar el motor NFA.' }]
        };
    }
    const { tokens, errors: lexErrors } = tokenize(input, entry.terminalAsts);

    // Si hubo errores léxicos críticos (toda la cadena inválida), retornar ya
    if (lexErrors.length > 0 && tokens.length <= 1) {
        return {
            accepted: false,
            tree:     null,
            treeJSON: null,
            tokens,
            steps:    [],
            errors:   lexErrors
        };
    }

    // Etapa 2+3: analizar con tabla LL(1)
    const { accepted, root, steps, errors: synErrors } = analyze(
        tokens,
        entry.parseTable,
        entry.grammar.initialSymbol
    );

    const allErrors = [...lexErrors, ...synErrors];

    return {
        accepted,
        tree:     accepted ? root : null,
        treeJSON: accepted ? root.toJSON() : null,
        tokens,
        steps,
        errors:   allErrors
    };
}

module.exports = { evaluate, tokenize, analyze, matchNFA, TreeNode, EOF_SYM };