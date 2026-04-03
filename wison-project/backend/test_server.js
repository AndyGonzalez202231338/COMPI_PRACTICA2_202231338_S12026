const app = require('./server.js');

// Esperar que el servidor arranque
setTimeout(async () => {
    const base = 'http://localhost:3000';

    async function req(method, path, body) {
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);
        const r = await fetch(base + path, opts);
        return { status: r.status, data: await r.json() };
    }

    let passed = 0, failed = 0;
    function test(name, fn) {
        return fn().then(() => { console.log(`✓  ${name}`); passed++; })
                   .catch(e  => { console.log(`✗  ${name}\n   ${e.message}`); failed++; });
    }

    const wisonExpr = `
Wison ¿
Lex {:
    Terminal $_plus   <- '+' ;
    Terminal $_star   <- '*' ;
    Terminal $_lparen <- '(' ;
    Terminal $_rparen <- ')' ;
    Terminal $_id     <- 'id' ;
:}
Syntax {{:
    No_Terminal %_E; No_Terminal %_Ep;
    No_Terminal %_T; No_Terminal %_Tp;
    No_Terminal %_F;
    Initial_Sim %_E ;
    %_E  <= %_T %_Ep ;
    %_Ep <= $_plus %_T %_Ep | ;
    %_T  <= %_F %_Tp ;
    %_Tp <= $_star %_F %_Tp | ;
    %_F  <= $_lparen %_E $_rparen | $_id ;
:}}
?Wison`;

    console.log('\n══ 1. Health ══\n');
    await test('GET /api/health responde ok', async () => {
        const r = await req('GET', '/api/health');
        if (r.data.status !== 'ok') throw new Error('status no es ok');
    });

    console.log('\n══ 2. POST /api/parse ══\n');
    await test('Parsea gramática válida y la guarda', async () => {
        const r = await req('POST', '/api/parse', { source: wisonExpr, name: 'expr' });
        if (r.status !== 201) throw new Error('status ' + r.status + ': ' + JSON.stringify(r.data));
        if (!r.data.ok) throw new Error(JSON.stringify(r.data));
        if (r.data.name !== 'expr') throw new Error('name incorrecto');
    });

    await test('Rechaza gramática con recursión izquierda', async () => {
        const r = await req('POST', '/api/parse', { source: `
Wison ¿
Lex {: Terminal $_a <- 'a' ; :}
Syntax {{:
    No_Terminal %_S;
    Initial_Sim %_S ;
    %_S <= %_S $_a | $_a ;
:}}
?Wison`, name: 'recur' });
        if (r.status !== 422) throw new Error('debía ser 422, fue ' + r.status);
        if (r.data.stage !== 'semantic') throw new Error('stage incorrecto: ' + r.data.stage);
    });

    await test('Rechaza código Wison con error sintáctico', async () => {
        const r = await req('POST', '/api/parse', { source: 'Wison ¿ Lex {: Terminal $_A \'a\' ; :} Syntax {{: :}} ?Wison', name: 'bad' });
        if (r.status !== 422) throw new Error('debía ser 422, fue ' + r.status);
        if (!['lexical','syntactic'].includes(r.data.stage)) throw new Error('stage: ' + r.data.stage);
    });

    await test('Rechaza body sin campo name', async () => {
        const r = await req('POST', '/api/parse', { source: wisonExpr });
        if (r.status !== 400) throw new Error('debía ser 400, fue ' + r.status);
    });

    await test('Rechaza body sin campo source', async () => {
        const r = await req('POST', '/api/parse', { name: 'test' });
        if (r.status !== 400) throw new Error('debía ser 400, fue ' + r.status);
    });

    console.log('\n══ 3. GET /api/analyzers ══\n');
    await test('Lista analizadores (debe tener expr)', async () => {
        const r = await req('GET', '/api/analyzers');
        if (!r.data.ok) throw new Error('not ok');
        const names = r.data.analyzers.map(a => a.name);
        if (!names.includes('expr')) throw new Error('expr no está en la lista: ' + names);
    });

    await test('Resumen contiene campos esperados', async () => {
        const r = await req('GET', '/api/analyzers');
        const expr = r.data.analyzers.find(a => a.name === 'expr');
        if (!expr) throw new Error('expr no encontrado');
        ['name','createdAt','terminalCount','ntCount','initialSymbol'].forEach(k => {
            if (expr[k] === undefined) throw new Error('falta campo: ' + k);
        });
        if (expr.terminalCount !== 5) throw new Error('terminalCount=' + expr.terminalCount);
        if (expr.ntCount !== 5) throw new Error('ntCount=' + expr.ntCount);
    });

    console.log('\n══ 4. GET /api/analyzers/:name ══\n');
    await test('Obtiene analizador completo por nombre', async () => {
        const r = await req('GET', '/api/analyzers/expr');
        if (!r.data.ok) throw new Error('not ok');
        if (!r.data.entry.parseTable) throw new Error('falta parseTable');
        if (!r.data.entry.firstSets)  throw new Error('falta firstSets');
    });

    await test('Retorna 404 para nombre inexistente', async () => {
        const r = await req('GET', '/api/analyzers/noexiste');
        if (r.status !== 404) throw new Error('debía ser 404, fue ' + r.status);
    });

    console.log('\n══ 5. POST /api/evaluate ══\n');
    await test('Acepta "id + id"', async () => {
        const r = await req('POST', '/api/evaluate', { name: 'expr', input: 'id + id' });
        if (!r.data.ok) throw new Error('not ok');
        if (!r.data.accepted) throw new Error('debía ser aceptada');
        if (!r.data.tree) throw new Error('falta árbol');
        if (r.data.tree.label !== '%_E') throw new Error('raíz incorrecta: ' + r.data.tree.label);
    });

    await test('Acepta "( id * id ) + id"', async () => {
        const r = await req('POST', '/api/evaluate', { name: 'expr', input: '( id * id ) + id' });
        if (!r.data.accepted) throw new Error('debía ser aceptada');
    });

    await test('Rechaza "id id" (sin operador)', async () => {
        const r = await req('POST', '/api/evaluate', { name: 'expr', input: 'id id' });
        if (!r.data.ok) throw new Error('not ok');
        if (r.data.accepted) throw new Error('debía ser rechazada');
        if (r.data.errors.length === 0) throw new Error('debía tener errores');
    });

    await test('Rechaza cadena vacía', async () => {
        const r = await req('POST', '/api/evaluate', { name: 'expr', input: '' });
        if (r.data.accepted) throw new Error('debía ser rechazada');
    });

    await test('Retorna tokens reconocidos', async () => {
        const r = await req('POST', '/api/evaluate', { name: 'expr', input: 'id + id' });
        const names = r.data.tokens.map(t => t.name);
        if (!names.includes('$_id'))   throw new Error('falta $_id');
        if (!names.includes('$_plus')) throw new Error('falta $_plus');
        if (!names.includes('$'))      throw new Error('falta EOF');
    });

    await test('Retorna pasos de la traza', async () => {
        const r = await req('POST', '/api/evaluate', { name: 'expr', input: 'id' });
        if (!r.data.steps || r.data.steps.length === 0) throw new Error('falta steps');
        const last = r.data.steps[r.data.steps.length - 1];
        if (last.action !== 'ACCEPT') throw new Error('último step: ' + last.action);
    });

    await test('Retorna 404 si el analizador no existe', async () => {
        const r = await req('POST', '/api/evaluate', { name: 'noexiste', input: 'id' });
        if (r.status !== 404) throw new Error('debía ser 404, fue ' + r.status);
    });

    console.log('\n══ 6. DELETE /api/analyzers/:name ══\n');
    // Crear uno temporal para borrar
    await req('POST', '/api/parse', { source: wisonExpr, name: 'temp' });

    await test('Elimina analizador existente', async () => {
        const r = await req('DELETE', '/api/analyzers/temp');
        if (!r.data.ok) throw new Error('not ok: ' + JSON.stringify(r.data));
    });

    await test('Retorna 404 al intentar eliminar uno inexistente', async () => {
        const r = await req('DELETE', '/api/analyzers/temp');
        if (r.status !== 404) throw new Error('debía ser 404, fue ' + r.status);
    });

    await test('Ya no aparece en la lista después de borrarlo', async () => {
        const r = await req('GET', '/api/analyzers');
        const names = r.data.analyzers.map(a => a.name);
        if (names.includes('temp')) throw new Error('temp sigue en la lista');
    });

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Resultado: ${passed} pasaron  |  ${failed} fallaron  |  ${passed+failed} total`);
    console.log('─'.repeat(50));
    process.exit(failed > 0 ? 1 : 0);
}, 500);
