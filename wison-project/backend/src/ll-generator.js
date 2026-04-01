/* 
   ll-generator.js
   Genera un analizador LL(1) a partir del AST producido por wison.jison
   Pipeline:
     1. Validación semántica
     2. Resolución de referencias entre terminales
     3. Detección de recursión por la izquierda
     4. Cálculo de FIRST y FOLLOW
     5. Construcción de la tabla M[A, a]
     6. Retorna AnalyzerEntry listo para SymbolTable
*/

'use strict';

const EPSILON = 'ε';
const EOF_SYM = '$';

class SemanticError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SemanticError';
        this.type = 'semantic';
    }
}

/**
 * Valida que el AST sea semánticamente correcto:
 *  - El símbolo inicial está declarado como No_Terminal
 *  - No hay NT usados en producciones sin haber sido declarados
 *  - No hay terminales referenciados en expresiones sin haber sido declarados
 *  - No hay NT declarados que nunca se usen (warning, no error)
 */
function validateSemantics(ast) {
    const errors = [];
    const warnings = [];

    const terminalNames = new Set(ast.terminals.map(t => t.name)); // Para validar referencias en patrones (terminal)
    const ntNames       = new Set(ast.nonTerminals.map(n => n.name)); // Para validar producciones y símbolo inicial (No_Terminal)

    // Símbolo inicial declarado
    if (!ntNames.has(ast.initialSymbol)) { //ejemplo: initialSymbol = S, pero S no declarado como No_Terminal
        errors.push(`El símbolo inicial "${ast.initialSymbol}" no está declarado como No_Terminal.`);
    }

    // Símbolos en producciones deben estar declarados
    const usedNTs = new Set();
    for (const prod of ast.productions) {
        // Cabeza de la producción
        if (!ntNames.has(prod.head)) { // ejemplo: S -> A B, pero S no declarado como No_Terminal
            errors.push(`La cabeza de producción "${prod.head}" no fue declarada con No_Terminal.`);
        }
        for (const alt of prod.alternatives) { // ejemplo: S -> A B | C, entonces alt = [A B] y alt = [C]
            for (const sym of alt) {
                if (sym.type === 'nonTerminal') {
                    usedNTs.add(sym.name);
                    if (!ntNames.has(sym.name)) { // ejemplo: S -> A B, pero A no declarado como No_Terminal
                        errors.push(`No terminal "${sym.name}" usado en producción de "${prod.head}" pero no declarado.`);
                    }
                } else {
                    // terminal
                    if (!terminalNames.has(sym.name)) { // ejemplo: S -> a B, pero a no declarado como Terminal
                        errors.push(`Terminal "${sym.name}" usado en producción de "${prod.head}" pero no declarado en el bloque Lex.`);
                    }
                }
            }
        }
    }

    // Referencias en patrones de terminales deben apuntar a terminales declarados
    // Ejemplo: $_Decimal pattern = "([0-9])*\\.$([0-9])+" -> referencia a $_Punto que no está declarado como terminal
    for (const t of ast.terminals) {
        if (t.patternType === 'reference' || t.patternType === 'concat') {
            // Buscar referencias $_Nombre dentro del patrón
            const refs = t.pattern.match(/\$_[a-zA-Z_][a-zA-Z0-9_]*/g) || []; // ejemplo: pattern = "([0-9])*$_Punto([0-9])+" -> refs = ["$_Punto"]
            for (const ref of refs) {
                if (!terminalNames.has(ref)) {
                    errors.push(`Terminal "${t.name}" referencia a "${ref}" que no está declarado.`);
                }
            }
        }
    }

    // NT declarados pero sin producción
    const headsWithProds = new Set(ast.productions.map(p => p.head)); // ejemplo: S -> A B, entonces headsWithProds = {S}
    for (const nt of ntNames) {
        if (!headsWithProds.has(nt)) { // ejemplo: S -> A B, pero S no declarado como No_Terminal, entonces ntNames = {S}, headsWithProds = {}, entonces se genera un warning
            warnings.push(`No terminal "${nt}" declarado pero sin producción definida.`);
        }
    }

    return { errors, warnings };
}

/**
 * Los terminales de tipo 'concat' o 'reference' pueden contener $_Nombre
 * en su patrón. Esta etapa los sustituye por el patrón real del terminal
 * referenciado, resolviendo en orden topológico.
 *
 * Ejemplo:
 *   $_Punto    pattern = "\\."
 *   $_Decimal  pattern = "([0-9])*$_Punto([0-9])+"
 *   resuelto: "([0-9])*(\\.)(([0-9])+)"
 */
function resolveTerminalReferences(terminals) {
    // Construir mapa nombre -> patrón
    const patternMap = {};
    for (const t of terminals) {
        patternMap[t.name] = t.pattern;
    }

    // Resolver con un máximo de N pasadas para evitar ciclos infinitos
    const MAX_PASSES = terminals.length + 1;
    let changed = true;
    let passes = 0;

    while (changed && passes < MAX_PASSES) {
        changed = false;
        passes++;
        for (const t of terminals) {
            const refs = t.pattern.match(/\$_[a-zA-Z_][a-zA-Z0-9_]*/g); // ejemplo: pattern = "([0-9])*$_Punto([0-9])+" -> refs = ["$_Punto"]
            if (!refs) continue;
            let newPattern = t.pattern;
            for (const ref of refs) {
                if (patternMap[ref] && !patternMap[ref].match(/\$_[a-zA-Z_]/)) {
                    // El referenciado ya está resuelto - sustituir
                    newPattern = newPattern.split(ref).join('(' + patternMap[ref] + ')'); // ejemplo: newPattern = "([0-9])*$_Punto([0-9])+" -> newPattern = "([0-9])*(\\.)(([0-9])+)"
                    changed = true;
                }
            }
            if (newPattern !== t.pattern) {
                t.pattern = newPattern;
                patternMap[t.name] = newPattern;
            }
        }
    }

    // Si quedaron referencias sin resolver, es un ciclo
    for (const t of terminals) {
        const refs = t.pattern.match(/\$_[a-zA-Z_][a-zA-Z0-9_]*/g);
        if (refs) {
            throw new SemanticError(
                `Referencia circular o no resuelta en terminal "${t.name}": ${refs.join(', ')}`
            );
        }
    }

    return patternMap;
}

/**
 * Detecta recursión izquierda directa e indirecta.
 *
 * Directa:  A -> A α
 * Indirecta: A -> B α, B -> A β
 *
 * Retorna un array de descripciones de los ciclos encontrados.
 */
function detectLeftRecursion(ast) {
    const problems = [];

    // Construir mapa NT -> primeros símbolos de cada alternativa
    const prodMap = {};
    for (const prod of ast.productions) {
        if (!prodMap[prod.head]) prodMap[prod.head] = [];
        for (const alt of prod.alternatives) {
            if (alt.length > 0) {
                prodMap[prod.head].push(alt[0]); // solo el primer símbolo de cada alternativa
            }
        }
    }

    const ntNames = new Set(ast.nonTerminals.map(n => n.name));

    // Para cada NT, hacer DFS buscando si puede alcanzarse a sí mismo
    // por el primer símbolo de alguna producción
    function canReach(start, current, visited) { // ejemplo: start = A, current = B, visited = {A}
        const firsts = prodMap[current] || []; // ejemplo: prodMap = {A: [B, C], B: [A], C: [D], D: []}, entonces prodMap[B] = [A]
        for (const sym of firsts) {
            if (sym.type !== 'nonTerminal') continue;
            if (sym.name === start) return true;
            if (visited.has(sym.name)) continue;
            visited.add(sym.name);
            if (canReach(start, sym.name, visited)) return true;
        }
        return false;
    }

    for (const nt of ntNames) {
        /* Recursión directa: si alguna alternativa de nt comienza con nt mismo, es recursión izquierda directa. Ejemplo: A -> A α*/
        const direct = (prodMap[nt] || []).some(s => s.type === 'nonTerminal' && s.name === nt);
        if (direct) {
            problems.push({ type: 'direct', nt, description: `Recursión izquierda directa en "${nt}" -> "${nt} ..."` });
            continue;
        }
        /* Recursión indirecta: si nt puede alcanzar a sí mismo por el primer símbolo de alguna producción, es recursión izquierda indirecta. Ejemplo: A -> B α, B -> A β*/
        const visited = new Set([nt]);
        if (canReach(nt, nt, visited)) {
            problems.push({ type: 'indirect', nt, description: `Recursión izquierda indirecta detectada en "${nt}"` });
        }
    }

    return problems;
}

/**
 * FIRST(α) = conjunto de terminales que pueden iniciar una cadena derivada de α.
 * Si α puede derivar ε, entonces ε ∈ FIRST(α).
 *
 * Algoritmo de punto fijo para calcular FIRST:
 * Se repite hasta que ningún conjunto cambie en una pasada completa.
 */
function computeFirst(ast) {
    //const terminalNames = new Set(ast.terminals.map(t => t.name));
    const first = {};

    // Inicializar FIRST vacío para cada NT
    for (const nt of ast.nonTerminals) {
        first[nt.name] = new Set();
    }
    // FIRST de un terminal es él mismo
    for (const t of ast.terminals) { // ejemplo: terminales = {a, b, c}, entonces los primeros de a, b, c son {a}, {b}, {c} respectivamente
        first[t.name] = new Set([t.name]);
    }
    // FIRST de ε es {ε}
    first[EPSILON] = new Set([EPSILON]);

    let changed = true;
    while (changed) {
        changed = false;

        for (const prod of ast.productions) {
            const A = prod.head; // ejemplo: S -> A B | C, entonces A = S

            for (const alt of prod.alternatives) {
                // Alternativa vacía -> ε ∈ FIRST(A)
                if (alt.length === 0) {
                    if (!first[A].has(EPSILON)) {
                        first[A].add(EPSILON);
                        changed = true;
                    }
                    continue;
                }

                // Para cada símbolo de la alternativa
                // FIRST(A) ⊇ FIRST(Y1) - {ε}
                // Si ε ∈ FIRST(Y1), agregar FIRST(Y2) - {ε}, etc.
                let allCanBeEpsilon = true;
                for (const sym of alt) {
                    const symFirst = first[sym.name] || new Set();
                    // Agregar todo excepto ε
                    for (const f of symFirst) { // ejemplo: alt = [A, B], entonces symFirst = first[A] y luego symFirst = first[B]
                        if (f !== EPSILON && !first[A].has(f)) {
                            first[A].add(f);
                            changed = true;
                        }
                    }
                    if (!symFirst.has(EPSILON)) { // Si este símbolo no puede ser ε, no seguimos a los siguientes símbolos de la alternativa
                        allCanBeEpsilon = false;
                        break;
                    }
                }
                // Si todos los símbolos pueden derivar ε, ε ∈ FIRST(A)
                if (allCanBeEpsilon && !first[A].has(EPSILON)) {
                    first[A].add(EPSILON);
                    changed = true;
                }
            }
        }
    }

    return first;
}

/**
 * firstOfSequence(symbols, firstSets)
 * Calcula FIRST de una secuencia de símbolos α = Y1 Y2 ... Yk
 * Usado para construir la tabla LL y para FOLLOW.
 */
function firstOfSequence(symbols, firstSets) {
    const result = new Set(); // ejemplo: symbols = [A, B], entonces se calcula first[A] y first[B] para construir el resultado
    let allEpsilon = true;

    for (const sym of symbols) {
        const sf = firstSets[sym.name] || new Set([sym.name]); 
        for (const f of sf) { // ejemplo: sym = A, entonces sf = first[A], y luego sym = B, entonces sf = first[B]
            if (f !== EPSILON) result.add(f); // Agregar todo excepto ε
        }
        if (!sf.has(EPSILON)) { // Si este símbolo no puede ser ε, no seguimos a los siguientes símbolos de la secuencia
            allEpsilon = false;
            break;
        }
    }
    if (allEpsilon) result.add(EPSILON); // Si todos los símbolos pueden ser ε, entonces ε ∈ FIRST(α)
    return result;
}

/**
 * FOLLOW(A) = conjunto de terminales que pueden aparecer inmediatamente
 *             a la derecha de A en alguna forma sentencial.
 *
 * Reglas:
 *   1. $ ∈ FOLLOW(S)  (símbolo inicial)
 *   2. Si A -> α B β: FIRST(β) - {ε} ⊆ FOLLOW(B)
 *   3. Si A -> α B β y ε ∈ FIRST(β): FOLLOW(A) ⊆ FOLLOW(B)
 *   4. Si A -> α B: FOLLOW(A) ⊆ FOLLOW(B)
 */
function computeFollow(ast, firstSets) {
    const follow = {};
    for (const nt of ast.nonTerminals) {
        follow[nt.name] = new Set();
    }
    // Regla 1 
    follow[ast.initialSymbol].add(EOF_SYM); // ejemplo: initialSymbol = S, entonces follow[S] = {$}

    let changed = true;
    while (changed) {
        changed = false;

        for (const prod of ast.productions) { // ejemplo: S -> A B | C, entonces prod.head = S, prod.alternatives = [[A, B], [C]]
            const A = prod.head; // ejemplo: A = S

            for (const alt of prod.alternatives) { // ejemplo: alt = [A, B] y luego alt = [C]
                for (let i = 0; i < alt.length; i++) {
                    const B = alt[i]; // ejemplo: alt = [A, B], entonces en la primera iteración B = A, y en la segunda iteración B = B
                    if (B.type !== 'nonTerminal') continue;

                    const beta = alt.slice(i + 1); // ejemplo: alt = [A, B], entonces en la primera iteración beta = [B], y en la segunda iteración beta = []

                    if (beta.length > 0) { // Si hay símbolos a la derecha de B
                        // Regla 2: A -> α B β: FIRST(β) - {ε} ⊆ FOLLOW(B)
                        const firstBeta = firstOfSequence(beta, firstSets); // ejemplo: beta = [B], entonces firstBeta = first[B], y luego beta = [], entonces firstBeta = {ε}
                        for (const f of firstBeta) {
                            if (f !== EPSILON && !follow[B.name].has(f)) {
                                follow[B.name].add(f);
                                changed = true;
                            }
                        }
                        // Regla 3: si ε ∈ FIRST(β)
                        if (firstBeta.has(EPSILON)) {
                            for (const f of follow[A]) {
                                if (!follow[B.name].has(f)) { // ejemplo: A = S, B = A, entonces follow[A] = follow[S], entonces se agrega $ a follow[A] y follow[B]
                                    follow[B.name].add(f);
                                    changed = true;
                                }
                            }
                        }
                    } else {
                        // Regla 4: B es el último símbolo
                        for (const f of follow[A]) {
                            if (!follow[B.name].has(f)) { // ejemplo: A = S, B = C, entonces follow[A] = follow[S], entonces se agrega $ a follow[A] y follow[B] y follow[C]
                                follow[B.name].add(f);
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
    }

    return follow;
}

/**
 * ETAPA 5 — Construcción de la tabla M[A, a]
 * Construye la tabla de análisis LL(1).
 *
 * Para cada producción A -> α:
 *   Para cada terminal a ∈ FIRST(α) - {ε}: M[A][a] = A -> α
 *   Si ε ∈ FIRST(α):
 *     Para cada terminal b ∈ FOLLOW(A): M[A][b] = A -> α
 *     Si $ ∈ FOLLOW(A): M[A][$] = A -> α
 *
 * Si alguna celda ya tiene una entrada -> conflicto (gramática no es LL(1)).
 */
function buildParseTable(ast, firstSets, followSets) {
    // table[NT][terminal] = { production, conflict: bool }
    const table = {};
    const conflicts = [];

    for (const nt of ast.nonTerminals) {
        table[nt.name] = {};
    }

    for (const prod of ast.productions) {
        const A = prod.head;

        prod.alternatives.forEach((alt, altIndex) => {
            const entry = { head: A, body: alt, altIndex };

            // FIRST de esta alternativa
            const firstAlpha = alt.length === 0
                ? new Set([EPSILON])
                : firstOfSequence(alt, firstSets);

            // Para cada terminal a ∈ FIRST(α) - {ε}
            for (const a of firstAlpha) {
                if (a === EPSILON) continue;
                if (table[A][a]) {
                    // Conflicto
                    conflicts.push({
                        nt: A, terminal: a,
                        existing: table[A][a],
                        incoming: entry,
                        description: `Conflicto en M["${A}"]["${a}"]: múltiples producciones`
                    });
                    // Marcar la celda como conflicto
                    if (!table[A][a].conflict) {
                        table[A][a] = { ...table[A][a], conflict: true, conflictWith: [entry] };
                    } else {
                        table[A][a].conflictWith.push(entry);
                    }
                } else {
                    table[A][a] = entry;
                }
            }

            // Si ε ∈ FIRST(α), usar FOLLOW(A)
            if (firstAlpha.has(EPSILON)) {
                for (const b of followSets[A]) {
                    if (table[A][b]) {
                        conflicts.push({
                            nt: A, terminal: b,
                            existing: table[A][b],
                            incoming: entry,
                            description: `Conflicto en M["${A}"]["${b}"]: múltiples producciones (via FOLLOW)`
                        });
                        if (!table[A][b].conflict) {
                            table[A][b] = { ...table[A][b], conflict: true, conflictWith: [entry] };
                        } else {
                            table[A][b].conflictWith.push(entry);
                        }
                    } else {
                        table[A][b] = entry;
                    }
                }
            }
        });
    }

    return { table, conflicts };
}

/**
 * generate(ast, name)
 *
 * Recibe el AST del parser Wison y un nombre para el analizador.
 * Ejecuta el pipeline completo y retorna un objeto AnalyzerEntry.
 *
 * Retorna:
 * {
 *   ok: true,
 *   entry: {
 *     name,
 *     grammar: ast,
 *     terminalPatterns,   // mapa $_Nombre -> regex resuelta
 *     firstSets,          // mapa NT -> Set<terminal>
 *     followSets,         // mapa NT -> Set<terminal>
 *     parseTable,         // tabla M[NT][terminal]
 *     warnings,
 *   }
 * }
 *
 * O en caso de error:
 * {
 *   ok: false,
 *   type: 'semantic',
 *   errors: [...],
 *   warnings: [...],
 *   leftRecursion: [...],  // si aplica
 * }
 */
function generate(ast, name) {
    const result = { // estructura base del resultado
        ok: false,
        errors: [],
        warnings: [],
        leftRecursion: []
    };

    // Etapa 1: Validación semántica
    const { errors: semErrors, warnings } = validateSemantics(ast);
    result.warnings = warnings;

    if (semErrors.length > 0) {
        result.errors = semErrors;
        result.type = 'semantic';
        return result;
    }

    // Etapa 2: Resolver referencias de terminales 
    const terminalsCopy = ast.terminals.map(t => ({ ...t }));
    let terminalPatterns;
    try {
        terminalPatterns = resolveTerminalReferences(terminalsCopy);
    } catch (e) {
        result.errors = [e.message];
        result.type = 'semantic';
        return result;
    }

    // Etapa 3: Detectar recursión izquierda
    const leftRecursion = detectLeftRecursion(ast);
    if (leftRecursion.length > 0) {
        result.leftRecursion = leftRecursion;
        result.errors = leftRecursion.map(r => r.description);
        result.type = 'semantic';
        return result;
    }

    // Etapa 4: FIRST y FOLLOW
    const firstSets  = computeFirst(ast);
    const followSets = computeFollow(ast, firstSets);

    // Etapa 5: Tabla LL(1)
    const { table, conflicts } = buildParseTable(ast, firstSets, followSets);

    if (conflicts.length > 0) {
        result.errors = conflicts.map(c => c.description);
        result.type = 'semantic';
        // Adjuntamos los conflictos con detalle por si el frontend los quiere mostrar
        result.conflicts = conflicts;
        return result;
    }

    // Etapa 6: Retornar resultado
    return {
        ok: true,
        entry: {
            name,
            grammar:         ast,
            terminalPatterns,
            firstSets:       setsToArrays(firstSets),
            followSets:      setsToArrays(followSets),
            parseTable:      table,
            warnings,
            createdAt:       new Date().toISOString()
        }
    };
}

// Convierte Map<string, Set> -> Map<string, string[]> para serialización JSON
function setsToArrays(sets) {
    const out = {};
    for (const [k, v] of Object.entries(sets)) {
        if (v instanceof Set) out[k] = [...v].sort();
    }
    return out;
}

// Exports
module.exports = {
    generate,
    // Exportar funciones individuales para testing
    validateSemantics,
    resolveTerminalReferences,
    detectLeftRecursion,
    computeFirst,
    computeFollow,
    buildParseTable,
    firstOfSequence,
    EPSILON,
    EOF_SYM
};