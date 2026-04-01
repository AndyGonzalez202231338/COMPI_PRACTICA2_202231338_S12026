/* evaluator.js
   Analiza una cadena de entrada usando la tabla LL(1) generada
   por ll-generator.js y construye el árbol de derivación.

   Pipeline:
     1. Tokenizar la entrada con los patrones del entry
     2. Analizar con el algoritmo LL(1) (pila + tabla)
     3. Construir árbol de derivación durante el análisis
     4. Retornar EvalResult con árbol o errores
*/

'use strict'; // Asegura que no se usen variables globales por error

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

/**
 * Tokenizar la entrada usando los patrones regex del entry.
 * tokenize(input, terminalPatterns)
 *
 * Convierte la cadena de entrada en un array de tokens usando los
 * patrones regex del entry. Cada token tiene la forma:
 *   { name: '$_id', lexeme: 'id', pos: 0 }
 *
 * Retorna { tokens, errors }
 *
 * Estrategia: en cada posición intenta todos los patrones en orden
 * de declaración (orden del bloque Lex) y toma el que produce
 * la coincidencia más larga (longest match).
 * Los espacios entre tokens se saltan automáticamente.
 */
function tokenize(input, terminalPatterns) {
    const tokens = [];
    const errors = [];
    let pos = 0;

    // Compilar patrones una sola vez
    // terminalPatterns es { '$_nombre': 'regex_string' }
    const compiled = Object.entries(terminalPatterns).map(([name, pattern]) => ({
        name,
        regex: new RegExp('^(?:' + pattern + ')', 'u')
    }));

    while (pos < input.length) {
        // Saltar espacios en blanco
        const spaceMatch = input.slice(pos).match(/^\s+/u);
        if (spaceMatch) {
            pos += spaceMatch[0].length;
            continue;
        }

        // Intentar todos los patrones, tomar el más largo
        let bestMatch = null;
        let bestName  = null;
        let bestLen   = 0;

        for (const { name, regex } of compiled) {
            const m = input.slice(pos).match(regex);
            if (m && m[0].length > bestLen) {
                bestLen   = m[0].length;
                bestMatch = m[0];
                bestName  = name;
            }
        }

        if (bestMatch !== null) {
            tokens.push({ name: bestName, lexeme: bestMatch, pos });
            pos += bestLen;
        } else {
            // Carácter no reconocido
            errors.push({
                type:    'lexical',
                message: `Carácter no reconocido: "${input[pos]}"`,
                pos,
                char:    input[pos]
            });
            pos++; // avanzar para no quedar en loop infinito
        }
    }

    // Agregar token de fin de cadena
    tokens.push({ name: EOF_SYM, lexeme: EOF_SYM, pos });

    return { tokens, errors };
}

/**
 * Análisis LL(1) + construcción del árbol
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

        // Caso 2: cima es terminal distinto de EOF
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
                const expected = row ? Object.keys(row).join(', ') : 'ninguno';
                const err = {
                    type:     'syntactic',
                    message:  `Error sintáctico en "${tokName}" ("${token.lexeme}"). ` +
                              `No hay producción para M["${top.symbol}"]["${tokName}"]. ` +
                              `Tokens válidos: ${expected}`,
                    pos:      token.pos,
                    expected,
                    found:    tokName
                };
                errors.push(err);
                recordStep('ERROR', err.message);

                // Recuperación: modo pánico — descartar token
                if (tokenIndex < tokens.length - 1) {
                    tokenIndex++;
                } else {
                    stack.pop();
                }
            }
            continue;
        }

        // Caso no esperado: símbolo desconocido en la pila 
        stack.pop();
    }

    // Si salimos del while sin ACCEPT, la cadena fue rechazada
    return { accepted: false, root, steps, errors };
}

function isTerminal(symbol) {
    return symbol === EOF_SYM || symbol.startsWith('$_') || symbol === 'ε';
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
    // Etapa 1: tokenizar
    const { tokens, errors: lexErrors } = tokenize(input, entry.terminalPatterns);

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

// Exports
module.exports = { evaluate, tokenize, analyze, TreeNode, EOF_SYM };