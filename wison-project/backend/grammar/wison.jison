/*
   wison.jison  –  Parser del lenguaje Wison
   Compiladores 1, Practica 2, Primer Semestre 2026
*/

/* -------Definición Léxica------- */
%lex

%%

\s+                                         {} // ingnorar esopacios en blanco

[/][*][*][\s\S]*?[*][/]                     {} 

"#"[^\n]*                                   {} // comentarios de una linea

"?"[ \t]*"Wison"                             return 'WISON_CLOSE' //cerradura de wison con posible espacio
"Wison"[ \t]*"\u00bf"                        return 'WISON_OPEN_JOINED' //apertura de wison con posible esapcio
"Wison"                                     return 'WISON'
"\u00bf"                                    return 'WISON_OPEN'

":}}"                                       return 'SYNTAX_CLOSE'
"{{:"                                       return 'SYNTAX_OPEN'
":}"                                        return 'LEX_CLOSE'
"{:"                                        return 'LEX_OPEN'

"No_Terminal"                               return 'NO_TERMINAL_KW'
"Initial_Sim"                               return 'INITIAL_SIM_KW'
"Terminal"                                  return 'TERMINAL_KW'
"Syntax"                                    return 'SYNTAX' //palabra reservada de analisis sintactico
"Lex"                                       return 'LEX' //palabra reservada de analisis lexico

"<-"                                        return 'ARROW'
"<="                                        return 'PROD_ARROW'

"[aA-zZ]"                                   return 'RANGE_ALPHA' // rango valido del alfabeto
"[0-9]"                                     return 'RANGE_DIGIT' // rango valido de digitos

\'([^\'\\]|\\.)*\'                          return 'LITERAL'

"*"                                         return 'STAR'
"+"                                         return 'PLUS'
"?"                                         return 'QUESTION'
"("                                         return 'LPAREN'
")"                                         return 'RPAREN'
"|"                                         return 'PIPE'
";"                                         return 'SEMICOLON'

\$_[a-zA-Z_][a-zA-Z0-9_]*                  return 'TERMINAL_NAME'
\%_[a-zA-Z_][a-zA-Z0-9_]*                  return 'NT_NAME'
\%[a-zA-Z_][a-zA-Z0-9_]*                   return 'NT_NAME'

<<EOF>>                                     return 'EOF' // indica final de texto
.   {
        parser.yy.errors = parser.yy.errors || [];
        var _ch = yytext;
        parser.yy.errors.push({
            type:    'lexical',
            message: 'Carácter no reconocido: "' + _ch + '" (U+' + _ch.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0') + ')',
            line:    yylloc.first_line,
            col:     yylloc.first_column
        });
    }

/lex

/* -------Asociación y Precedencia de Operadores------- */
%right QUESTION STAR PLUS
%left  CONCAT

%start program

/* -------Reglas Gramaticales------- */
%%

program
    : wison_open lex_block syntax_block WISON_CLOSE EOF
        {
            return {
                terminals:    $2.terminals,
                nonTerminals: $3.nonTerminals,
                initialSymbol: $3.initialSymbol,
                productions:  $3.productions,
                errors: (parser.yy.errors || [])
            };
        }
    | wison_open lex_block syntax_block WISON_CLOSE
        {
            return {
                terminals:    $2.terminals,
                nonTerminals: $3.nonTerminals,
                initialSymbol: $3.initialSymbol,
                productions:  $3.productions,
                errors: (parser.yy.errors || [])
            };
        }
    ;

wison_open
    : WISON WISON_OPEN       { $$ = true; } /* Wison ¿ con espacio */
    | WISON_OPEN_JOINED      { $$ = true; } /* Wison¿ sin espacio  */
    ;

/* -- Bloque Lex -- */
lex_block
    : LEX LEX_OPEN terminal_decl_list LEX_CLOSE
        { $$ = { terminals: $3 }; }
    | LEX LEX_OPEN LEX_CLOSE
        { $$ = { terminals: [] }; }
    /* Recuperación: cierre incorrecto — se usó :}} en lugar de :} */
    | LEX LEX_OPEN terminal_decl_list SYNTAX_CLOSE
        {
            parser.yy.errors = parser.yy.errors || [];
            parser.yy.errors.push({
                type: 'syntactic',
                message: 'Cierre incorrecto del bloque Lex en línea ' + @4.first_line + ': se usó ":}}" pero el bloque se abrió con "{:" — use ":}" para cerrar Lex.',
                line: @4.first_line,
                col:  @4.first_column
            });
            $$ = { terminals: $3 };
        }
    | LEX LEX_OPEN SYNTAX_CLOSE
        {
            parser.yy.errors = parser.yy.errors || [];
            parser.yy.errors.push({
                type: 'syntactic',
                message: 'Cierre incorrecto del bloque Lex en línea ' + @3.first_line + ': se usó ":}}" pero el bloque se abrió con "{:" — use ":}" para cerrar Lex.',
                line: @3.first_line,
                col:  @3.first_column
            });
            $$ = { terminals: [] };
        }
    ;

terminal_decl_list
    : terminal_decl_list terminal_decl
        { $$ = $1.concat($2 ? [$2] : []); }
    | terminal_decl
        { $$ = $1 ? [$1] : []; }
    ;

/* Declaración válida */
terminal_decl
    : TERMINAL_KW TERMINAL_NAME ARROW regex_expr SEMICOLON
        { $$ = { name:$2, pattern:$4.pattern, patternType:$4.type, line:@2.first_line, col:@2.first_column }; }
    /* Recuperación: cualquier error en la declaración, sincronizar en ; */
    | TERMINAL_KW error SEMICOLON
        {
            parser.yy.errors = parser.yy.errors || [];
            parser.yy.errors.push({
                type: 'syntactic',
                message: 'Error en declaración de Terminal en línea ' + @2.first_line + '. Formato esperado: Terminal $_Nombre <- expresión ;',
                line: @2.first_line,
                col:  @2.first_column
            });
            $$ = null;
        }
    /* Recuperación: error léxico dentro de la declaración */
    | error SEMICOLON
        {
            parser.yy.errors = parser.yy.errors || [];
            parser.yy.errors.push({
                type: 'lexical',
                message: 'Token inesperado en bloque Lex en línea ' + @1.first_line + '. Se ignoró hasta el siguiente ;',
                line: @1.first_line,
                col:  @1.first_column
            });
            $$ = null;
        }
    ;

/* -- Expresiones regulares -- */
regex_expr
    : regex_expr STAR							/* e*   */
        { $$ = { pattern:'('+$1.pattern+')*', type:'kleene' }; }
    | regex_expr PLUS							/* e+   */
        { $$ = { pattern:'('+$1.pattern+')+', type:'positive' }; }
    | regex_expr QUESTION						/* e?   */
        { $$ = { pattern:'('+$1.pattern+')?', type:'optional' }; }
    | LPAREN regex_expr RPAREN regex_expr   %prec CONCAT		/* (e1)(e2) */
        { $$ = { pattern:$2.pattern+$4.pattern, type:'concat' }; }
    | LPAREN regex_expr RPAREN						/* (e)  */
        { $$ = { pattern:$2.pattern, type:'group' }; }
    | LITERAL								/* 'a'  */
        {
            var raw = yytext.slice(1,-1);
            var esc = raw.replace(/[-[\]{}()*+?.,\\^$|#\s]/g,'\\$&');
            esc = esc.replace(/\\-/g, '-')
            $$ = { pattern:esc, type:'literal' };
        }
    | RANGE_ALPHA					/* [aA-zZ] */
        { $$ = { pattern:'[a-zA-Z]', type:'range' }; }
    | RANGE_DIGIT					/* [0-9]   */
        { $$ = { pattern:'[0-9]', type:'range' }; }
    | TERMINAL_NAME					/* referencia */
        { $$ = { pattern:yytext, type:'reference' }; }
    ;

/* -- Bloque Syntax -- */
syntax_block
    : SYNTAX SYNTAX_OPEN nt_decl_list initial_decl production_list SYNTAX_CLOSE
        { $$ = { nonTerminals:$3, initialSymbol:$4.name, initialSymbolLoc:{line:$4.line, col:$4.col}, productions:$5 }; }
    /* Recuperación: cierre incorrecto — se usó :} en lugar de :}} */
    | SYNTAX SYNTAX_OPEN nt_decl_list initial_decl production_list LEX_CLOSE
        {
            parser.yy.errors = parser.yy.errors || [];
            parser.yy.errors.push({
                type: 'syntactic',
                message: 'Cierre incorrecto del bloque Syntax en línea ' + @6.first_line + ': se usó ":}" pero el bloque se abrió con "{{:" — use ":}}" para cerrar Syntax.',
                line: @6.first_line,
                col:  @6.first_column
            });
            $$ = { nonTerminals:$3, initialSymbol:$4.name, initialSymbolLoc:{line:$4.line, col:$4.col}, productions:$5 };
        }
    ;

nt_decl_list
    : nt_decl_list nt_decl
        { $$ = $1.concat($2 ? [$2] : []); }
    | nt_decl
        { $$ = $1 ? [$1] : []; }
    ;

/* Declaración válida de No_Terminal */
nt_decl
    : NO_TERMINAL_KW NT_NAME SEMICOLON
        { $$ = { name:$2, isInitial:false, line:@2.first_line, col:@2.first_column }; }
    /* Recuperación */
    | NO_TERMINAL_KW error SEMICOLON
        {
            parser.yy.errors = parser.yy.errors || [];
            parser.yy.errors.push({
                type: 'syntactic',
                message: 'Error en declaración de No_Terminal en línea ' + @2.first_line + '. Formato esperado: No_Terminal %_Nombre ;',
                line: @2.first_line,
                col:  @2.first_column
            });
            $$ = null;
        }
    ;

initial_decl
    : INITIAL_SIM_KW NT_NAME SEMICOLON
        { $$ = { name:$2, line:@2.first_line, col:@2.first_column }; }
    /* Recuperación */
    | INITIAL_SIM_KW error SEMICOLON
        {
            parser.yy.errors = parser.yy.errors || [];
            parser.yy.errors.push({
                type: 'syntactic',
                message: 'Error en declaración de Initial_Sim en línea ' + @2.first_line + '. Formato esperado: Initial_Sim %_Nombre ;',
                line: @2.first_line,
                col:  @2.first_column
            });
            $$ = '';
        }
    ;

production_list
    : production_list production
        { $$ = $1.concat($2 ? [$2] : []); }
    | production
        { $$ = $1 ? [$1] : []; }
    ;

/* Producción válida */
production
    : NT_NAME PROD_ARROW alternative_list SEMICOLON
        { $$ = { head:$1, alternatives:$3, line:@1.first_line, col:@1.first_column }; }
    /* Recuperación: error en el cuerpo de la producción */
    | NT_NAME error SEMICOLON
        {
            parser.yy.errors = parser.yy.errors || [];
            parser.yy.errors.push({
                type: 'syntactic',
                message: 'Error en producción de "' + $1 + '" en línea ' + @2.first_line + '. Formato esperado: %_NT <= símbolo ... ;',
                line: @2.first_line,
                col:  @2.first_column
            });
            $$ = null;
        }
    /* Recuperación: error completo en la línea */
    | error SEMICOLON
        {
            parser.yy.errors = parser.yy.errors || [];
            parser.yy.errors.push({
                type: 'syntactic',
                message: 'Producción inválida en línea ' + @1.first_line + '. Se ignoró hasta el siguiente ;',
                line: @1.first_line,
                col:  @1.first_column
            });
            $$ = null;
        }
    ;

alternative_list 							/* A | B */
    : alternative_list PIPE symbol_list  { $$ = $1.concat([$3]); }
    | alternative_list PIPE              { $$ = $1.concat([[]]); }	/* A | ε (épsilon) */
    | symbol_list                        { $$ = [$1]; }
    ;

symbol_list
    : symbol_list symbol  { $$ = $1.concat([$2]); }
    | symbol              { $$ = [$1]; }
    ;

symbol
    : NT_NAME       { $$ = { name:$1, type:'nonTerminal', line:@1.first_line, col:@1.first_column }; } /* %_S, %_Expr ... */
    | TERMINAL_NAME { $$ = { name:$1, type:'terminal',    line:@1.first_line, col:@1.first_column }; } /* $_A, $_FIN ... */
    ;

%%

if (typeof module !== 'undefined') {
    module.exports = {
        parser: parser,
        parseWison: function(source) {
            try {
                return parser.parse(source);
            } catch (e) {
                throw {
                    type: (e.message && e.message.indexOf('Parse error') !== -1)
                          ? 'syntactic' : 'lexical',
                    message: e.message || String(e),
                    line: (e.hash && e.hash.loc) ? e.hash.loc.first_line : null
                };
            }
        }
    };
}