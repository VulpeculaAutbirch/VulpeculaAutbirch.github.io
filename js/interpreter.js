/*
 * OCR A Level (H046/H446) Pseudocode interpreter.
 * Follows the OCR "Pseudocode Guide" (August 2015).
 * Works in the browser (window.OCRPseudo) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OCRPseudo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- errors

  class PseudoError extends Error {
    constructor(message, line, kind) {
      super(message);
      this.line = line;
      this.kind = kind || 'Runtime error';
    }
    toString() {
      return this.kind + (this.line ? ' (line ' + this.line + ')' : '') + ': ' + this.message;
    }
  }

  class ReturnSignal {
    constructor(value) { this.value = value; }
  }

  class StopSignal {}

  // ----------------------------------------------------------------- lexer

  const KEYWORDS = new Set([
    'if', 'then', 'elseif', 'else', 'endif',
    'for', 'to', 'step', 'next', 'endfor',
    'while', 'endwhile', 'do', 'until',
    'switch', 'case', 'default', 'endswitch',
    'function', 'endfunction', 'procedure', 'endprocedure', 'return',
    'global', 'array',
    'class', 'endclass', 'inherits', 'public', 'private', 'new', 'super',
    'and', 'or', 'not', 'mod', 'div',
    'true', 'false', 'null',
    'byval', 'byref',
  ]);

  // keywords that may also be used as variable / attribute names (e.g. node.next)
  const SOFT_KEYWORDS = new Set(['next', 'step', 'default']);

  // "end if" -> "endif" etc.
  const END_MERGE = new Set(['if', 'while', 'function', 'procedure', 'switch', 'class', 'for']);

  const OPERATORS = ['==', '!=', '<>', '<=', '>=', '<', '>', '=', '+', '-', '*', '/', '^', '(', ')', '[', ']', ',', '.', ':'];

  function tokenize(src) {
    src = src
      .replace(/\r\n?/g, '\n')
      .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"') // curly quotes copied from the PDF
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u00A0\u3000]/g, ' ')
      .replace(/\t/g, '    ');
    const toks = [];
    let i = 0, line = 1, lineStart = 0;
    const push = (type, value, start) => toks.push({ type, value, line, col: start - lineStart + 1 });
    const prevType = () => (toks.length ? toks[toks.length - 1] : null);

    while (i < src.length) {
      const ch = src[i];
      if (ch === '\n') {
        push('NEWLINE', '\n', i);
        i++; line++; lineStart = i;
        continue;
      }
      if (ch === ' ') { i++; continue; }
      if (ch === '/' && src[i + 1] === '/') {
        while (i < src.length && src[i] !== '\n') i++;
        continue;
      }
      if (/[0-9]/.test(ch)) {
        const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i));
        push('NUMBER', parseFloat(m[0]), i);
        i += m[0].length;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const start = i;
        let j = i + 1;
        while (j < src.length && src[j] !== ch && src[j] !== '\n') j++;
        if (src[j] !== ch) throw new PseudoError('Unterminated string — missing closing ' + ch, line, 'Syntax error');
        push('STRING', src.slice(i + 1, j), start);
        i = j + 1;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
        let word = m[0];
        const start = i;
        i += word.length;
        const lower = word.toLowerCase();
        const prev = prevType();
        // after a '.' everything is a name (e.g. node.next, file.close)
        if (prev && prev.type === 'OP' && prev.value === '.') { push('IDENT', word, start); continue; }
        // 12MOD5 / 17DIV5 written without spaces, as in the guide
        const md = /^(mod|div)([0-9]+)$/.exec(lower);
        if (md && prev && (prev.type === 'NUMBER' || prev.type === 'IDENT' || (prev.type === 'OP' && (prev.value === ')' || prev.value === ']')))) {
          push('KW', md[1], start);
          push('NUMBER', parseInt(md[2], 10), start + 3);
          continue;
        }
        if (lower === 'end') {
          const m2 = /^ +([A-Za-z]+)\b/.exec(src.slice(i));
          if (m2 && END_MERGE.has(m2[1].toLowerCase())) {
            push('KW', 'end' + m2[1].toLowerCase(), start);
            i += m2[0].length;
            continue;
          }
        }
        if (KEYWORDS.has(lower)) push('KW', lower, start);
        else push('IDENT', word, start);
        continue;
      }
      const op = OPERATORS.find((o) => src.startsWith(o, i));
      if (op) {
        push('OP', op === '<>' ? '!=' : op, i);
        i += op.length;
        continue;
      }
      throw new PseudoError("Unexpected character '" + ch + "'", line, 'Syntax error');
    }
    push('NEWLINE', '\n', i);
    push('EOF', null, i);
    return toks;
  }

  // ---------------------------------------------------------------- parser

  const BLOCK_ENDERS = new Set([
    'endif', 'else', 'elseif', 'endwhile', 'until', 'next', 'endfor', 'endswitch',
    'case', 'default', 'endfunction', 'endprocedure', 'endclass',
  ]);

  function describe(tok) {
    if (tok.type === 'NEWLINE') return 'end of line';
    if (tok.type === 'EOF') return 'end of program';
    if (tok.type === 'STRING') return '"' + tok.value + '"';
    return "'" + tok.value + "'";
  }

  class Parser {
    constructor(tokens) {
      this.t = tokens;
      this.p = 0;
      this.eqIsCompare = true;
    }

    peek(o) { return this.t[Math.min(this.p + (o || 0), this.t.length - 1)]; }
    next() { return this.t[this.p++]; }
    isKw(v, o) { const t = this.peek(o); return t.type === 'KW' && t.value === v; }
    isOp(v, o) { const t = this.peek(o); return t.type === 'OP' && t.value === v; }
    eatKw(v) { if (this.isKw(v)) { this.p++; return true; } return false; }
    eatOp(v) { if (this.isOp(v)) { this.p++; return true; } return false; }

    error(msg, tok) {
      tok = tok || this.peek();
      throw new PseudoError(msg, tok.line, 'Syntax error');
    }
    expectOp(v, what) {
      if (!this.eatOp(v)) this.error("Expected '" + v + "'" + (what ? ' ' + what : '') + ' but found ' + describe(this.peek()));
    }
    expectEnd(kw, openTok) {
      if (!this.eatKw(kw)) {
        this.error("Expected '" + kw + "' to close the '" + openTok.value + "' on line " + openTok.line + ', but found ' + describe(this.peek()));
      }
    }
    expectName(what) {
      const t = this.peek();
      if (t.type === 'IDENT' || (t.type === 'KW' && SOFT_KEYWORDS.has(t.value))) { this.p++; return t.value; }
      this.error('Expected ' + what + ' but found ' + describe(t));
    }
    skipNewlines() { while (this.peek().type === 'NEWLINE') this.p++; }
    endOfStatement() {
      const t = this.peek();
      if (t.type === 'NEWLINE') { this.p++; return; }
      if (t.type === 'EOF') return;
      this.error('Unexpected ' + describe(t) + ' — expected the end of the line');
    }

    // a soft keyword used as a variable, e.g. "next = node.next"
    softKwIsName(o) {
      const t = this.peek(o);
      if (t.type !== 'KW' || !SOFT_KEYWORDS.has(t.value)) return false;
      const n = this.peek((o || 0) + 1);
      return n.type === 'OP' && (n.value === '=' || n.value === '.' || n.value === '[');
    }

    withEq(flag, fn) {
      const saved = this.eqIsCompare;
      this.eqIsCompare = flag;
      try { return fn(); } finally { this.eqIsCompare = saved; }
    }

    parseProgram() {
      const body = this.parseBlock(new Set());
      return { type: 'Program', body };
    }

    parseBlock(terms) {
      const body = [];
      for (;;) {
        this.skipNewlines();
        const t = this.peek();
        if (t.type === 'EOF') return body;
        if (t.type === 'KW' && !this.softKwIsName()) {
          if (terms.has(t.value)) return body;
          if (BLOCK_ENDERS.has(t.value)) this.error("Unexpected '" + t.value + "' — there is no matching block for it to close");
        }
        body.push(this.parseStatement());
      }
    }

    parseStatement() {
      const t = this.peek();
      if (t.type === 'KW' && !this.softKwIsName()) {
        switch (t.value) {
          case 'if': return this.parseIf();
          case 'for': return this.parseFor();
          case 'while': return this.parseWhile();
          case 'do': return this.parseDo();
          case 'switch': return this.parseSwitch();
          case 'function':
          case 'procedure': return this.parseSub('public');
          case 'public':
          case 'private': {
            this.next();
            if (!this.isKw('function') && !this.isKw('procedure')) this.error("'" + t.value + "' can only be used inside a class, or before function/procedure");
            return this.parseSub(t.value);
          }
          case 'class': return this.parseClass();
          case 'return': return this.parseReturn();
          case 'global': {
            this.next();
            if (this.isKw('array')) return this.parseArrayDecl(true);
            return this.parseSimple(true);
          }
          case 'array': return this.parseArrayDecl(false);
          case 'then': this.error("Unexpected 'then' — 'then' belongs at the end of an if line");
        }
      }
      return this.parseSimple(false);
    }

    parseSimple(isGlobal) {
      const first = this.peek();
      const lhs = this.withEq(false, () => this.parseExpr());
      if (this.eatOp('=')) {
        if (!['Ident', 'Index', 'Member'].includes(lhs.type)) this.error('You can only assign to a variable, an array element or an attribute', first);
        if (isGlobal && lhs.type !== 'Ident') this.error("'global' must be followed by a variable name", first);
        const value = this.parseExpr();
        this.endOfStatement();
        return { type: 'Assign', target: lhs, value, isGlobal, line: first.line };
      }
      if (isGlobal) {
        if (lhs.type !== 'Ident') this.error("'global' must be followed by a variable name", first);
        this.endOfStatement();
        return { type: 'GlobalDecl', name: lhs.name, line: first.line };
      }
      if (lhs.type === 'Binary' && lhs.op === '==') this.error("'==' compares two values. To store a value in a variable use a single '='", first);
      if (lhs.type !== 'Call' && lhs.type !== 'New') {
        if (lhs.type === 'Ident' && this.peek().type !== 'NEWLINE' && this.peek().type !== 'EOF') {
          this.error('Unexpected ' + describe(this.peek()) + " after '" + lhs.name + "'. Did you forget brackets, e.g. " + lhs.name + '(...)?');
        }
        this.error('This line does nothing — expected an assignment (x = ...) or a subroutine call', first);
      }
      this.endOfStatement();
      return { type: 'ExprStmt', expr: lhs, line: first.line };
    }

    parseIf() {
      const open = this.next();
      const branches = [];
      let cond = this.parseExpr();
      this.eatKw('then');
      this.endOfStatement();
      const terms = new Set(['elseif', 'else', 'endif']);
      branches.push({ cond, body: this.parseBlock(terms) });
      let elseBody = null;
      for (;;) {
        if (this.isKw('elseif') || (this.isKw('else') && this.isKw('if', 1))) {
          if (this.next().value === 'else') this.next();
          cond = this.parseExpr();
          this.eatKw('then');
          this.endOfStatement();
          branches.push({ cond, body: this.parseBlock(terms) });
          continue;
        }
        if (this.isKw('else')) {
          this.next();
          this.endOfStatement();
          elseBody = this.parseBlock(new Set(['endif']));
        }
        break;
      }
      this.expectEnd('endif', open);
      this.endOfStatement();
      return { type: 'If', branches, elseBody, line: open.line };
    }

    parseFor() {
      const open = this.next();
      const v = this.peek();
      if (v.type !== 'IDENT') this.error("Expected a loop variable after 'for', e.g. for i=0 to 9");
      this.next();
      this.expectOp('=', 'after the loop variable');
      const start = this.parseExpr();
      if (!this.eatKw('to')) this.error("Expected 'to' in the for loop, e.g. for i=0 to 9 — found " + describe(this.peek()));
      const end = this.parseExpr();
      let step = null;
      if (this.eatKw('step')) step = this.parseExpr();
      this.endOfStatement();
      const body = this.parseBlock(new Set(['next', 'endfor']));
      if (this.eatKw('next')) {
        if (this.peek().type === 'IDENT') {
          const n = this.next();
          if (n.value !== v.value) this.error("'next " + n.value + "' does not match 'for " + v.value + "' on line " + open.line, n);
        }
      } else if (!this.eatKw('endfor')) {
        this.error("Expected 'next " + v.value + "' to close the 'for' on line " + open.line + ', but found ' + describe(this.peek()));
      }
      this.endOfStatement();
      return { type: 'For', varName: v.value, start, end, step, body, line: open.line };
    }

    parseWhile() {
      const open = this.next();
      const cond = this.parseExpr();
      this.eatKw('do');
      this.endOfStatement();
      const body = this.parseBlock(new Set(['endwhile']));
      this.expectEnd('endwhile', open);
      this.endOfStatement();
      return { type: 'While', cond, body, line: open.line };
    }

    parseDo() {
      const open = this.next();
      this.endOfStatement();
      const body = this.parseBlock(new Set(['until']));
      this.expectEnd('until', open);
      const cond = this.parseExpr();
      this.endOfStatement();
      return { type: 'DoUntil', cond, body, line: open.line };
    }

    parseSwitch() {
      const open = this.next();
      const subject = this.parseExpr();
      this.eatOp(':');
      this.endOfStatement();
      const cases = [];
      let defaultBody = null;
      const terms = new Set(['case', 'default', 'endswitch']);
      for (;;) {
        this.skipNewlines();
        if (this.isKw('case')) {
          const c = this.next();
          const values = [this.parseExpr()];
          while (this.eatOp(',')) values.push(this.parseExpr());
          this.expectOp(':', 'after the case value');
          cases.push({ values, body: this.parseBlock(terms), line: c.line });
        } else if (this.isKw('default')) {
          this.next();
          this.eatOp(':');
          defaultBody = this.parseBlock(terms);
        } else break;
      }
      this.expectEnd('endswitch', open);
      this.endOfStatement();
      return { type: 'Switch', subject, cases, defaultBody, line: open.line };
    }

    parseSub(access) {
      const open = this.next(); // function | procedure
      const kind = open.value;
      let name;
      if (this.isKw('new')) { this.next(); name = 'new'; } else name = this.expectName('a ' + kind + ' name');
      this.expectOp('(', 'after the ' + kind + ' name');
      const params = [];
      if (!this.isOp(')')) {
        do {
          let byRef = false;
          if (this.eatKw('byref')) byRef = true;
          else this.eatKw('byval');
          const pname = this.expectName('a parameter name');
          if (this.eatOp(':')) {
            if (this.eatKw('byref')) byRef = true;
            else if (!this.eatKw('byval')) this.error("Expected 'byVal' or 'byRef' after ':'");
          }
          if (params.some((p) => p.name === pname)) this.error("Parameter '" + pname + "' is listed twice");
          params.push({ name: pname, byRef });
        } while (this.eatOp(','));
      }
      this.expectOp(')', 'to close the parameter list');
      this.endOfStatement();
      const endKw = 'end' + kind;
      const body = this.parseBlock(new Set([endKw]));
      this.expectEnd(endKw, open);
      this.endOfStatement();
      return { type: 'SubDecl', kind, name, params, body, access, line: open.line };
    }

    parseClass() {
      const open = this.next();
      const name = this.expectName('a class name');
      let parent = null;
      if (this.eatKw('inherits')) parent = this.expectName('a parent class name');
      this.endOfStatement();
      const attrs = [];
      const methods = new Map();
      for (;;) {
        this.skipNewlines();
        const t = this.peek();
        if (this.isKw('endclass') || t.type === 'EOF') break;
        let access = 'public';
        if (this.isKw('public') || this.isKw('private')) access = this.next().value;
        if (this.isKw('function') || this.isKw('procedure')) {
          const m = this.parseSub(access);
          if (methods.has(m.name)) this.error("Method '" + m.name + "' is defined twice in class " + name, t);
          methods.set(m.name, m);
        } else if (this.isKw('array')) {
          this.next();
          const aname = this.expectName('an array name');
          const dims = this.parseDims();
          this.endOfStatement();
          attrs.push({ name: aname, access, dims, init: null, line: t.line });
        } else {
          const names = [this.expectName('an attribute or method in class ' + name)];
          while (this.eatOp(',')) names.push(this.expectName('an attribute name'));
          let init = null;
          if (this.eatOp('=')) init = this.parseExpr();
          this.endOfStatement();
          for (const n of names) attrs.push({ name: n, access, dims: null, init, line: t.line });
        }
      }
      this.expectEnd('endclass', open);
      this.endOfStatement();
      return { type: 'ClassDecl', name, parent, attrs, methods, line: open.line };
    }

    parseDims() {
      if (!this.eatOp('[')) return null;
      const dims = this.withEq(true, () => {
        const d = [this.parseExpr()];
        while (this.eatOp(',')) d.push(this.parseExpr());
        return d;
      });
      this.expectOp(']', 'to close the array size');
      return dims;
    }

    parseArrayDecl(isGlobal) {
      const open = this.next(); // array
      const name = this.expectName('an array name');
      const dims = this.parseDims();
      let init = null;
      if (this.eatOp('=')) init = this.parseExpr();
      if (!dims && !init) this.error('An array needs a size, e.g. array ' + name + '[5]');
      this.endOfStatement();
      return { type: 'ArrayDecl', name, dims, init, isGlobal, line: open.line };
    }

    parseReturn() {
      const open = this.next();
      let value = null;
      if (this.peek().type !== 'NEWLINE' && this.peek().type !== 'EOF') value = this.parseExpr();
      this.endOfStatement();
      return { type: 'Return', value, line: open.line };
    }

    // ---- expressions

    parseExpr() { return this.parseOr(); }

    parseOr() {
      let l = this.parseAnd();
      while (this.isKw('or')) {
        const t = this.next();
        const r = this.parseAnd();
        l = bin('or', l, r, t.line);
      }
      return l;
    }

    parseAnd() {
      let l = this.parseNot();
      while (this.isKw('and')) {
        const t = this.next();
        const r = this.parseNot();
        l = bin('and', l, r, t.line);
      }
      return l;
    }

    parseNot() {
      if (this.isKw('not')) {
        const t = this.next();
        const e = this.parseNot();
        return { type: 'Unary', op: 'not', expr: e, line: t.line, async: e.async };
      }
      return this.parseCompare();
    }

    parseCompare() {
      let l = this.parseAdd();
      for (;;) {
        const t = this.peek();
        if (t.type !== 'OP') break;
        let op = t.value;
        if (op === '=' && this.eqIsCompare) op = '==';
        if (!['==', '!=', '<', '>', '<=', '>='].includes(op)) break;
        this.next();
        const r = this.parseAdd();
        l = bin(op, l, r, t.line);
      }
      return l;
    }

    parseAdd() {
      let l = this.parseMul();
      while (this.isOp('+') || this.isOp('-')) {
        const t = this.next();
        l = bin(t.value, l, this.parseMul(), t.line);
      }
      return l;
    }

    parseMul() {
      let l = this.parseUnary();
      while (this.isOp('*') || this.isOp('/') || this.isKw('mod') || this.isKw('div')) {
        const t = this.next();
        l = bin(t.value, l, this.parseUnary(), t.line);
      }
      return l;
    }

    parseUnary() {
      if (this.isOp('-') || this.isOp('+')) {
        const t = this.next();
        const e = this.parseUnary();
        return { type: 'Unary', op: t.value, expr: e, line: t.line, async: e.async };
      }
      return this.parsePower();
    }

    parsePower() {
      const base = this.parsePostfix();
      if (this.isOp('^')) {
        const t = this.next();
        return bin('^', base, this.parseUnary(), t.line);
      }
      return base;
    }

    parsePostfix() {
      let e = this.parsePrimary();
      for (;;) {
        if (this.isOp('(')) {
          const t = this.next();
          const args = this.parseArgs(')');
          e = { type: 'Call', callee: e, args, line: t.line, async: true };
        } else if (this.isOp('[')) {
          const t = this.next();
          const indices = this.withEq(true, () => {
            const d = [this.parseExpr()];
            while (this.eatOp(',')) d.push(this.parseExpr());
            return d;
          });
          this.expectOp(']', 'to close the index');
          e = { type: 'Index', obj: e, indices, line: t.line, async: e.async || indices.some((x) => x.async) };
        } else if (this.isOp('.')) {
          const t = this.next();
          const nt = this.peek();
          if (nt.type !== 'IDENT') this.error("Expected a name after '.'");
          this.next();
          e = { type: 'Member', obj: e, name: nt.value, line: t.line, async: e.async };
        } else break;
      }
      return e;
    }

    parseArgs(close) {
      return this.withEq(true, () => {
        const args = [];
        if (!this.isOp(close)) {
          do args.push(this.parseExpr()); while (this.eatOp(','));
        }
        this.expectOp(close, close === ')' ? 'to close the brackets' : 'to close the list');
        return args;
      });
    }

    parsePrimary() {
      const t = this.peek();
      switch (t.type) {
        case 'NUMBER': this.next(); return { type: 'Lit', value: t.value, line: t.line };
        case 'STRING': this.next(); return { type: 'Lit', value: t.value, line: t.line };
        case 'IDENT': this.next(); return { type: 'Ident', name: t.value, line: t.line };
        case 'OP':
          if (t.value === '(') {
            this.next();
            const e = this.withEq(true, () => this.parseExpr());
            this.expectOp(')', 'to close the brackets');
            return e;
          }
          if (t.value === '[') {
            this.next();
            const items = this.parseArgs(']');
            return { type: 'ArrayLit', items, line: t.line, async: items.some((x) => x.async) };
          }
          break;
        case 'KW':
          if (t.value === 'true' || t.value === 'false') { this.next(); return { type: 'Lit', value: t.value === 'true', line: t.line }; }
          if (t.value === 'null') { this.next(); return { type: 'Lit', value: null, line: t.line }; }
          if (t.value === 'not') return this.parseNot();
          if (t.value === 'new') {
            this.next();
            const cname = this.expectName("a class name after 'new'");
            let args = [];
            if (this.eatOp('(')) args = this.parseArgs(')');
            return { type: 'New', className: cname, args, line: t.line, async: true };
          }
          if (t.value === 'super') {
            this.next();
            if (!this.isOp('.')) this.error("'super' must be followed by .methodName(...)");
            return { type: 'Super', line: t.line };
          }
          if (SOFT_KEYWORDS.has(t.value)) { this.next(); return { type: 'Ident', name: t.value, line: t.line }; }
          break;
      }
      this.error('Expected a value but found ' + describe(t));
    }
  }

  function bin(op, l, r, line) {
    return { type: 'Binary', op, left: l, right: r, line, async: !!(l.async || r.async) };
  }

  function parse(src) {
    return new Parser(tokenize(src)).parseProgram();
  }

  // ---------------------------------------------------------------- values

  class Cell {
    constructor(value) { this.value = value; }
  }

  class PClass {
    constructor(decl, parent) {
      this.name = decl.name;
      this.decl = decl;
      this.parent = parent;
      this.methods = decl.methods;
    }
    findMethod(name) {
      for (let c = this; c; c = c.parent) {
        if (c.methods.has(name)) return { method: c.methods.get(name), cls: c };
      }
      return null;
    }
    isA(other) {
      for (let c = this; c; c = c.parent) if (c === other) return true;
      return false;
    }
  }

  class PObject {
    constructor(cls) {
      this.cls = cls;
      this.fields = new Map(); // name -> { cell, access, cls }
    }
  }

  class PFile {
    constructor(name, mode, lines) {
      this.name = name;
      this.mode = mode;
      this.lines = lines;
      this.pos = 0;
      this.closed = false;
    }
  }

  function fmtNum(n) {
    if (Number.isInteger(n)) return String(n);
    if (Number.isNaN(n)) return 'NaN';
    return String(n);
  }

  function format(v, nested) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return fmtNum(v);
    if (typeof v === 'string') return nested ? '"' + v + '"' : v;
    if (Array.isArray(v)) return '[' + v.map((x) => format(x, true)).join(', ') + ']';
    if (v instanceof PObject) return '<' + v.cls.name + ' object>';
    if (v instanceof PFile) return '<file ' + v.name + '>';
    return String(v);
  }

  function typeName(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'real number';
    if (typeof v === 'string') return 'string';
    if (typeof v === 'boolean') return 'boolean';
    if (Array.isArray(v)) return 'array';
    if (v instanceof PObject) return v.cls.name + ' object';
    if (v instanceof PFile) return 'file';
    return typeof v;
  }

  function aType(v) {
    const t = typeName(v);
    return (/^[aeiou]/i.test(t) ? 'an ' : 'a ') + t;
  }

  function cap(s) { return s[0].toUpperCase() + s.slice(1); }

  function copyVal(v) {
    return Array.isArray(v) ? v.map(copyVal) : v;
  }

  function makeArray(sizes, k) {
    k = k || 0;
    const n = sizes[k];
    const arr = new Array(n);
    for (let i = 0; i < n; i++) arr[i] = k + 1 < sizes.length ? makeArray(sizes, k + 1) : null;
    return arr;
  }

  function splitLines(text) {
    if (text === '') return [];
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  // ----------------------------------------------------------- interpreter

  class Interpreter {
    /**
     * opts.io:  { write(text), input(prompt) -> Promise<string> }
     * opts.fs:  { read(name) -> string|null, write(name, text) }
     * opts.yield: optional () => Promise, called periodically to keep a UI responsive
     */
    constructor(opts) {
      opts = opts || {};
      this.io = opts.io;
      this.fs = opts.fs || null;
      this.yieldFn = opts.yield || null;
      this.maxDepth = opts.maxDepth || 3000;
      this.random = opts.random || Math.random;
      this.stopped = false;
    }

    stop() { this.stopped = true; }

    err(msg, node) {
      return new PseudoError(msg, node && node.line ? node.line : this.curLine);
    }

    async run(source) {
      const ast = typeof source === 'string' ? parse(source) : source;
      this.globals = new Map();
      this.globalNames = new Set();
      this.subs = new Map();
      this.classes = new Map();
      this.depth = 0;
      this.steps = 0;
      this.curLine = 0;
      this.lastYield = Date.now();
      this.hoist(ast.body);
      this.main = { locals: this.globals, thisObj: null, cls: null, isMain: true };
      try {
        await this.execBlock(ast.body, this.main);
      } catch (e) {
        if (e instanceof ReturnSignal) throw new PseudoError("'return' can only be used inside a function or procedure", this.curLine);
        if (e instanceof PseudoError || e instanceof StopSignal) throw e;
        if (e instanceof RangeError) throw new PseudoError('Stack overflow — recursion is too deep (missing base case?)', this.curLine);
        throw new PseudoError('Internal error: ' + (e && e.message ? e.message : e), this.curLine);
      }
    }

    hoist(body) {
      const classDecls = new Map();
      for (const s of body) {
        if (s.type === 'SubDecl') {
          if (this.subs.has(s.name)) throw new PseudoError("Subroutine '" + s.name + "' is defined twice", s.line);
          s.hoisted = true;
          this.subs.set(s.name, s);
        } else if (s.type === 'ClassDecl') {
          if (classDecls.has(s.name)) throw new PseudoError("Class '" + s.name + "' is defined twice", s.line);
          s.hoisted = true;
          classDecls.set(s.name, s);
        }
      }
      const building = new Set();
      const build = (name, line) => {
        if (this.classes.has(name)) return this.classes.get(name);
        const decl = classDecls.get(name);
        if (!decl) throw new PseudoError("Class '" + name + "' is not defined", line);
        if (building.has(name)) throw new PseudoError("Class '" + name + "' inherits from itself", decl.line);
        building.add(name);
        const parent = decl.parent ? build(decl.parent, decl.line) : null;
        const cls = new PClass(decl, parent);
        this.classes.set(name, cls);
        return cls;
      };
      for (const name of classDecls.keys()) build(name);
    }

    async pause() {
      if (this.stopped) throw new StopSignal();
      if (this.yieldFn && Date.now() - this.lastYield > 30) {
        await this.yieldFn();
        this.lastYield = Date.now();
        if (this.stopped) throw new StopSignal();
      }
    }

    async execBlock(stmts, f) {
      for (let i = 0; i < stmts.length; i++) {
        const s = stmts[i];
        this.curLine = s.line;
        if ((++this.steps & 1023) === 0) await this.pause();
        if (s.type === 'Assign' && !s.value.async && !s.target.async) {
          this.assign(s.target, this.evalSync(s.value, f), f, s.isGlobal);
        } else {
          await this.exec(s, f);
        }
      }
    }

    // evaluate an expression, avoiding promises when the expression contains no calls
    async ev(n, f) {
      return n.async ? this.evalAsync(n, f) : this.evalSync(n, f);
    }

    cond(n, f, v) {
      if (typeof v !== 'boolean') {
        throw this.err('A condition must be true or false, but this gives ' + typeName(v) + ' ' + format(v, true), n);
      }
      return v;
    }

    async exec(s, f) {
      switch (s.type) {
        case 'Assign': {
          const v = s.value.async ? await this.evalAsync(s.value, f) : this.evalSync(s.value, f);
          if (s.target.async) await this.assignAsync(s.target, v, f);
          else this.assign(s.target, v, f, s.isGlobal);
          return;
        }
        case 'ExprStmt':
          if (s.expr.type === 'Call') await this.evalCall(s.expr, f, true);
          else await this.evalAsync(s.expr, f);
          return;
        case 'If': {
          for (const b of s.branches) {
            const c = b.cond.async ? await this.evalAsync(b.cond, f) : this.evalSync(b.cond, f);
            if (this.cond(b.cond, f, c)) { await this.execBlock(b.body, f); return; }
          }
          if (s.elseBody) await this.execBlock(s.elseBody, f);
          return;
        }
        case 'For': {
          const start = this.num(await this.ev(s.start, f), s.start, 'The start of a for loop');
          const end = this.num(await this.ev(s.end, f), s.end, 'The end of a for loop');
          const step = s.step ? this.num(await this.ev(s.step, f), s.step, 'The step of a for loop') : 1;
          if (step === 0) throw this.err('A for loop step cannot be 0', s);
          this.setVar(s.varName, start, f, false);
          for (;;) {
            const v = this.getVar(s.varName, f, s);
            if (step > 0 ? v > end : v < end) break;
            if ((++this.steps & 1023) === 0) await this.pause();
            await this.execBlock(s.body, f);
            this.setVar(s.varName, this.getVar(s.varName, f, s) + step, f, false);
          }
          return;
        }
        case 'While':
          for (;;) {
            const c = s.cond.async ? await this.evalAsync(s.cond, f) : this.evalSync(s.cond, f);
            if (!this.cond(s.cond, f, c)) break;
            if ((++this.steps & 1023) === 0) await this.pause();
            await this.execBlock(s.body, f);
          }
          return;
        case 'DoUntil':
          for (;;) {
            if ((++this.steps & 1023) === 0) await this.pause();
            await this.execBlock(s.body, f);
            const c = s.cond.async ? await this.evalAsync(s.cond, f) : this.evalSync(s.cond, f);
            if (this.cond(s.cond, f, c)) break;
          }
          return;
        case 'Switch': {
          const subject = await this.ev(s.subject, f);
          for (const c of s.cases) {
            for (const vn of c.values) {
              if (this.equals(subject, await this.ev(vn, f))) { await this.execBlock(c.body, f); return; }
            }
          }
          if (s.defaultBody) await this.execBlock(s.defaultBody, f);
          return;
        }
        case 'ArrayDecl': {
          let value;
          if (s.dims) {
            const sizes = [];
            for (const d of s.dims) {
              const n = await this.ev(d, f);
              if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw this.err('An array size must be a whole number ≥ 0, not ' + format(n, true), s);
              sizes.push(n);
            }
            value = makeArray(sizes);
          }
          if (s.init) {
            const init = await this.ev(s.init, f);
            if (!Array.isArray(init)) throw this.err('An array must be given a list of values, e.g. array ' + s.name + ' = [1, 2, 3]', s);
            value = copyVal(init);
          }
          this.setVar(s.name, value, f, s.isGlobal);
          return;
        }
        case 'GlobalDecl':
          this.globalNames.add(s.name);
          if (!this.globals.has(s.name)) this.globals.set(s.name, new Cell(null));
          return;
        case 'Return': {
          if (f.isMain) throw this.err("'return' can only be used inside a function or procedure", s);
          const v = s.value ? await this.ev(s.value, f) : undefined;
          throw new ReturnSignal(v);
        }
        case 'SubDecl':
        case 'ClassDecl':
          if (!s.hoisted) throw this.err((s.type === 'ClassDecl' ? 'Classes' : 'Functions and procedures') + ' must be declared at the top level of the program, not inside another block', s);
          return;
      }
      throw this.err('Unknown statement ' + s.type, s);
    }

    // ---- variables

    lookupCell(name, f) {
      let c = f.locals.get(name);
      if (c) return c;
      if (f.thisObj) {
        const fld = f.thisObj.fields.get(name);
        if (fld) return fld.cell;
      }
      if (!f.isMain) {
        c = this.globals.get(name);
        if (c) return c;
      }
      return null;
    }

    getVar(name, f, node) {
      const c = this.lookupCell(name, f);
      if (c) return c.value;
      let msg = "Variable '" + name + "' has not been given a value yet";
      if (this.subs.has(name)) msg = "'" + name + "' is a subroutine — call it with brackets, e.g. " + name + '()';
      else if (this.classes.has(name)) msg = "'" + name + "' is a class — create an object with new " + name + '(...)';
      else {
        const similar = this.similarName(name, f);
        if (similar) msg += ". Did you mean '" + similar + "'? (names are case-sensitive)";
      }
      throw this.err(msg, node);
    }

    similarName(name, f) {
      const lower = name.toLowerCase();
      const pools = [f.locals.keys(), this.globals.keys()];
      if (f.thisObj) pools.push(f.thisObj.fields.keys());
      for (const pool of pools) for (const k of pool) if (k.toLowerCase() === lower) return k;
      return null;
    }

    setVar(name, value, f, forceGlobal) {
      if (forceGlobal) this.globalNames.add(name);
      if (forceGlobal || f.isMain) {
        const c = this.globals.get(name);
        if (c) c.value = value; else this.globals.set(name, new Cell(value));
        return;
      }
      let c = f.locals.get(name);
      if (c) { c.value = value; return; }
      if (f.thisObj) {
        const fld = f.thisObj.fields.get(name);
        if (fld) { fld.cell.value = value; return; }
      }
      if (this.globalNames.has(name)) {
        c = this.globals.get(name);
        if (c) c.value = value; else this.globals.set(name, new Cell(value));
        return;
      }
      f.locals.set(name, new Cell(value));
    }

    assign(target, value, f, isGlobal) {
      if (target.type === 'Ident') return this.setVar(target.name, value, f, isGlobal);
      if (target.type === 'Index') {
        const base = this.evalSync(target.obj, f);
        const idx = target.indices.map((i) => this.evalSync(i, f));
        return this.setIndex(base, idx, value, target);
      }
      if (target.type === 'Member') {
        const obj = this.evalSync(target.obj, f);
        return this.setMember(obj, target, value, f);
      }
    }

    async assignAsync(target, value, f) {
      if (target.type === 'Index') {
        const base = await this.ev(target.obj, f);
        const idx = [];
        for (const i of target.indices) idx.push(await this.ev(i, f));
        return this.setIndex(base, idx, value, target);
      }
      if (target.type === 'Member') {
        const obj = await this.ev(target.obj, f);
        return this.setMember(obj, target, value, f);
      }
    }

    setIndex(base, idx, value, node) {
      let arr = base;
      for (let k = 0; k < idx.length; k++) {
        if (typeof arr === 'string') throw this.err('Strings cannot be changed one character at a time', node);
        if (!Array.isArray(arr)) throw this.err('Cannot use [ ] on ' + aType(arr) + (arr === null ? ' (has the array been declared?)' : ''), node);
        this.checkIndex(arr, idx[k], node);
        if (k === idx.length - 1) arr[idx[k]] = value;
        else arr = arr[idx[k]];
      }
    }

    setMember(obj, node, value, f) {
      if (!(obj instanceof PObject)) throw this.err("Cannot set '." + node.name + "' on a " + typeName(obj), node);
      const fld = this.getField(obj, node.name, f, node);
      fld.cell.value = value;
    }

    checkIndex(arr, i, node) {
      if (typeof i !== 'number' || !Number.isInteger(i)) throw this.err('An index must be a whole number, not ' + typeName(i) + ' ' + format(i, true), node);
      if (i < 0 || i >= arr.length) {
        throw this.err('Index ' + i + ' is out of range — valid indexes are 0 to ' + (arr.length - 1) + ' (the array has ' + arr.length + ' elements)', node);
      }
    }

    getField(obj, name, f, node) {
      const fld = obj.fields.get(name);
      if (!fld) {
        if (obj.cls.findMethod(name)) throw this.err("'" + name + "' is a method — call it with brackets, e.g. ." + name + '()', node);
        throw this.err('A ' + obj.cls.name + " object has no attribute '" + name + "'", node);
      }
      if (fld.access === 'private' && !this.canAccessPrivate(obj, f)) {
        throw this.err("'" + name + "' is private in class " + fld.cls.name + ' — it can only be used inside the class (use a public method instead)', node);
      }
      return fld;
    }

    canAccessPrivate(obj, f) {
      return !!f.cls && (obj.cls.isA(f.cls) || f.cls.isA(obj.cls));
    }

    // ---- expressions

    num(v, node, what) {
      if (typeof v !== 'number') throw this.err(what + ' must be a number, not ' + typeName(v) + ' ' + format(v, true), node);
      return v;
    }

    equals(a, b) {
      return a === b || (a === undefined && b === null) || (a === null && b === undefined);
    }

    binop(op, a, b, node) {
      switch (op) {
        case '+':
          if (typeof a === 'number' && typeof b === 'number') return a + b;
          if (typeof a === 'string' && typeof b === 'string') return a + b;
          if (typeof a === 'string' || typeof b === 'string') {
            const other = typeof a === 'string' ? b : a;
            let hint = '';
            if (typeof other === 'number') hint = '. Use str() to turn the number into a string, e.g. "Total: " + str(total) — or int()/float() to turn a string into a number';
            throw this.err('Cannot add ' + aType(a) + ' and ' + aType(b) + hint, node);
          }
          throw this.err("Cannot use '+' on a " + typeName(a) + ' and ' + aType(b), node);
        case '-': case '*': case '/': case '^': case 'mod': case 'div': {
          const sym = op === 'mod' ? 'MOD' : op === 'div' ? 'DIV' : op;
          if (typeof a !== 'number' || typeof b !== 'number') {
            let hint = '';
            if (typeof a === 'string' || typeof b === 'string') hint = ' (use int() or float() to convert a string to a number)';
            throw this.err("Cannot use '" + sym + "' on a " + typeName(a) + ' and ' + aType(b) + hint, node);
          }
          if (op === '-') return a - b;
          if (op === '*') return a * b;
          if (op === '^') return Math.pow(a, b);
          if (b === 0) throw this.err('Division by zero', node);
          if (op === '/') return a / b;
          if (op === 'div') return Math.floor(a / b);
          let r = a % b;
          if (r !== 0 && (r < 0) !== (b < 0)) r += b;
          return r;
        }
        case '==': return this.equals(a, b);
        case '!=': return !this.equals(a, b);
        case '<': case '>': case '<=': case '>=': {
          const ok = (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');
          if (!ok) throw this.err("Cannot compare a " + typeName(a) + ' and ' + aType(b) + " with '" + op + "'", node);
          if (op === '<') return a < b;
          if (op === '>') return a > b;
          if (op === '<=') return a <= b;
          return a >= b;
        }
      }
      throw this.err('Unknown operator ' + op, node);
    }

    unop(op, v, node) {
      if (op === 'not') {
        if (typeof v !== 'boolean') throw this.err('NOT needs true or false, not ' + typeName(v), node);
        return !v;
      }
      if (typeof v !== 'number') throw this.err("Cannot use '" + op + "' on a " + typeName(v), node);
      return op === '-' ? -v : v;
    }

    logic(op, a, node) {
      if (typeof a !== 'boolean') throw this.err((op === 'and' ? 'AND' : 'OR') + ' needs true or false on both sides, but got ' + typeName(a) + ' ' + format(a, true), node);
      return a;
    }

    index(base, idx, node) {
      let v = base;
      for (const i of idx) {
        if (Array.isArray(v)) {
          this.checkIndex(v, i, node);
          v = v[i];
          if (v === undefined) v = null;
        } else if (typeof v === 'string') {
          this.checkIndex(v, i, node);
          v = v[i];
        } else {
          throw this.err('Cannot use [ ] on ' + aType(v) + (v === null ? ' (has the array been declared?)' : ''), node);
        }
      }
      return v;
    }

    member(obj, node, f) {
      const name = node.name;
      const k = name.toLowerCase();
      if (typeof obj === 'string') {
        if (k === 'length') return obj.length;
        if (k === 'upper') return obj.toUpperCase();
        if (k === 'lower') return obj.toLowerCase();
        throw this.err("Strings have no property '" + name + "'", node);
      }
      if (Array.isArray(obj)) {
        if (k === 'length') return obj.length;
        throw this.err("Arrays have no property '" + name + "' (only .length)", node);
      }
      if (obj instanceof PObject) return this.getField(obj, name, f, node).cell.value;
      if (obj === null || obj === undefined) throw this.err("Cannot read '." + name + "' of null — the variable/attribute has no value yet", node);
      throw this.err("A " + typeName(obj) + " has no property '" + name + "'", node);
    }

    evalSync(n, f) {
      switch (n.type) {
        case 'Lit': return n.value;
        case 'Ident': return this.getVar(n.name, f, n);
        case 'Binary': {
          if (n.op === 'and') return this.logic('and', this.evalSync(n.left, f), n.left) && this.logic('and', this.evalSync(n.right, f), n.right);
          if (n.op === 'or') return this.logic('or', this.evalSync(n.left, f), n.left) || this.logic('or', this.evalSync(n.right, f), n.right);
          return this.binop(n.op, this.evalSync(n.left, f), this.evalSync(n.right, f), n);
        }
        case 'Unary': return this.unop(n.op, this.evalSync(n.expr, f), n);
        case 'Index': return this.index(this.evalSync(n.obj, f), n.indices.map((i) => this.evalSync(i, f)), n);
        case 'Member':
          if (n.obj.type === 'Super') throw this.err("Use super.method(...) to call a parent method", n);
          return this.member(this.evalSync(n.obj, f), n, f);
        case 'ArrayLit': return n.items.map((i) => this.evalSync(i, f));
        case 'Super': throw this.err("'super' must be followed by .methodName(...)", n);
      }
      throw this.err('Cannot evaluate ' + n.type, n);
    }

    async evalAsync(n, f) {
      switch (n.type) {
        case 'Call': return this.evalCall(n, f, false);
        case 'New': return this.evalNew(n, f);
        case 'Binary': {
          if (n.op === 'and') return this.logic('and', await this.ev(n.left, f), n.left) && this.logic('and', await this.ev(n.right, f), n.right);
          if (n.op === 'or') return this.logic('or', await this.ev(n.left, f), n.left) || this.logic('or', await this.ev(n.right, f), n.right);
          const a = await this.ev(n.left, f);
          const b = await this.ev(n.right, f);
          return this.binop(n.op, a, b, n);
        }
        case 'Unary': return this.unop(n.op, await this.ev(n.expr, f), n);
        case 'Index': {
          const base = await this.ev(n.obj, f);
          const idx = [];
          for (const i of n.indices) idx.push(await this.ev(i, f));
          return this.index(base, idx, n);
        }
        case 'Member': return this.member(await this.ev(n.obj, f), n, f);
        case 'ArrayLit': {
          const out = [];
          for (const i of n.items) out.push(await this.ev(i, f));
          return out;
        }
      }
      return this.evalSync(n, f);
    }

    // ---- calls

    async evalArgs(argNodes, f) {
      const out = [];
      for (const a of argNodes) out.push(await this.ev(a, f));
      return out;
    }

    async evalCall(n, f, asStatement) {
      const callee = n.callee;
      if (callee.type === 'Ident') {
        const name = callee.name;
        if (f.thisObj) {
          const m = f.thisObj.cls.findMethod(name);
          if (m) return this.callSub(m.method, n.args, f, f.thisObj, m.cls, asStatement, n);
        }
        const sub = this.subs.get(name);
        if (sub) return this.callSub(sub, n.args, f, null, null, asStatement, n);
        const b = BUILTINS[name.toLowerCase()];
        if (b) {
          if (b.proc && !asStatement) throw this.err("'" + name + "' does not give back a value, so it can't be used inside an expression", n);
          const args = await this.evalArgs(n.args, f);
          if (b.arity && (args.length < b.arity[0] || args.length > b.arity[1])) {
            throw this.err(name + '() takes ' + (b.arity[0] === b.arity[1] ? b.arity[0] : b.arity[0] + ' to ' + b.arity[1]) + ' argument(s) but was given ' + args.length, n);
          }
          return b.fn.call(this, args, n);
        }
        if (this.classes.has(name)) throw this.err('To create an object write: new ' + name + '(...)', n);
        for (const k of this.subs.keys()) {
          if (k.toLowerCase() === name.toLowerCase()) throw this.err("There is no subroutine called '" + name + "'. Did you mean '" + k + "'? (names are case-sensitive)", n);
        }
        throw this.err("There is no function or procedure called '" + name + "'", n);
      }
      if (callee.type === 'Member') {
        const name = callee.name;
        if (callee.obj.type === 'Super') {
          if (!f.cls || !f.thisObj) throw this.err("'super' can only be used inside a class method", n);
          const parent = f.cls.parent;
          if (!parent) throw this.err('Class ' + f.cls.name + " doesn't inherit from another class, so 'super' can't be used", n);
          const m = parent.findMethod(name);
          if (!m) {
            if (name === 'new' && n.args.length === 0) return undefined;
            throw this.err('The parent class ' + parent.name + " has no method '" + name + "'", n);
          }
          return this.callSub(m.method, n.args, f, f.thisObj, m.cls, asStatement, n);
        }
        const obj = await this.ev(callee.obj, f);
        if (obj instanceof PObject) {
          const m = obj.cls.findMethod(name);
          if (!m) {
            if (obj.fields.has(name)) throw this.err("'" + name + "' is an attribute, not a method — remove the brackets", n);
            throw this.err('A ' + obj.cls.name + " object has no method '" + name + "'", n);
          }
          if (m.method.access === 'private' && !this.canAccessPrivate(obj, f)) {
            throw this.err("Method '" + name + "' is private in class " + m.cls.name + ' — it can only be called from inside the class', n);
          }
          return this.callSub(m.method, n.args, f, obj, m.cls, asStatement, n);
        }
        const args = await this.evalArgs(n.args, f);
        if (typeof obj === 'string') return this.stringMethod(obj, name, args, n);
        if (obj instanceof PFile) return this.fileMethod(obj, name, args, n, asStatement);
        if (Array.isArray(obj) && name.toLowerCase() === 'length' && args.length === 0) return obj.length;
        if (obj === null || obj === undefined) throw this.err("Cannot call '." + name + "()' on null — the variable/attribute has no value yet", n);
        throw this.err(cap(aType(obj)) + " has no method '" + name + "'", n);
      }
      throw this.err('This cannot be called like a function', n);
    }

    async makeRef(node, f) {
      if (node.type === 'Ident') {
        let c = this.lookupCell(node.name, f);
        if (!c) {
          this.setVar(node.name, null, f, false);
          c = this.lookupCell(node.name, f);
        }
        return c;
      }
      if (node.type === 'Index') {
        const base = await this.ev(node.obj, f);
        const idx = [];
        for (const i of node.indices) idx.push(await this.ev(i, f));
        const self = this;
        const owner = idx.length > 1 ? this.index(base, idx.slice(0, -1), node) : base;
        const last = idx[idx.length - 1];
        if (!Array.isArray(owner)) throw this.err('byRef needs a variable, array element or attribute', node);
        this.checkIndex(owner, last, node);
        return {
          get value() { return owner[last] === undefined ? null : owner[last]; },
          set value(v) { self.checkIndex(owner, last, node); owner[last] = v; },
        };
      }
      if (node.type === 'Member' && node.obj.type !== 'Super') {
        const obj = await this.ev(node.obj, f);
        if (!(obj instanceof PObject)) throw this.err('byRef needs a variable, array element or attribute', node);
        return this.getField(obj, node.name, f, node).cell;
      }
      throw this.err('A byRef parameter must be given a variable (not a value such as 5 or "abc")', node);
    }

    async callSub(decl, argNodes, caller, thisObj, cls, asStatement, node) {
      const what = (cls ? 'Method' : decl.kind === 'function' ? 'Function' : 'Procedure') + " '" + decl.name + "'";
      if (decl.kind === 'procedure' && !asStatement && decl.name !== 'new') {
        throw this.err(what + " is a procedure, so it doesn't give back a value and can't be used in an expression. Use a function with 'return' instead", node);
      }
      if (argNodes.length !== decl.params.length) {
        throw this.err(what + ' needs ' + decl.params.length + ' argument(s) but was given ' + argNodes.length, node);
      }
      const locals = new Map();
      for (let i = 0; i < decl.params.length; i++) {
        const p = decl.params[i];
        if (p.byRef) locals.set(p.name, await this.makeRef(argNodes[i], caller));
        else locals.set(p.name, new Cell(copyVal(await this.ev(argNodes[i], caller))));
      }
      if (++this.depth > this.maxDepth) {
        this.depth = 0;
        throw this.err('Stack overflow — more than ' + this.maxDepth + ' nested calls. Is your recursion missing a base case?', node);
      }
      const frame = { locals, thisObj, cls, isMain: false };
      const savedLine = this.curLine;
      try {
        await this.execBlock(decl.body, frame);
      } catch (e) {
        if (e instanceof ReturnSignal) {
          if (decl.kind === 'function' && e.value === undefined) throw this.err(what + ' must return a value', decl);
          return e.value;
        }
        throw e;
      } finally {
        this.depth--;
        this.curLine = savedLine;
      }
      if (decl.kind === 'function' && !asStatement) {
        throw this.err(what + " reached 'end" + decl.kind + "' without returning a value", decl);
      }
      return undefined;
    }

    async evalNew(n, f) {
      const cls = this.classes.get(n.className);
      if (!cls) throw this.err("Class '" + n.className + "' is not defined", n);
      const obj = new PObject(cls);
      const chain = [];
      for (let c = cls; c; c = c.parent) chain.unshift(c);
      for (const c of chain) {
        const initFrame = { locals: new Map(), thisObj: obj, cls: c, isMain: false };
        for (const a of c.decl.attrs) {
          let v = null;
          if (a.dims) {
            const sizes = [];
            for (const d of a.dims) sizes.push(await this.ev(d, initFrame));
            v = makeArray(sizes);
          } else if (a.init) {
            v = copyVal(await this.ev(a.init, initFrame));
          }
          obj.fields.set(a.name, { cell: new Cell(v), access: a.access, cls: c });
        }
      }
      const ctor = cls.findMethod('new');
      if (ctor) {
        await this.callSub(ctor.method, n.args, f, obj, ctor.cls, true, n);
      } else if (n.args.length) {
        throw this.err('Class ' + cls.name + ' has no constructor (procedure new), so it takes no arguments', n);
      }
      return obj;
    }

    stringMethod(s, name, args, n) {
      const k = name.toLowerCase();
      const needInt = (v, what) => {
        if (typeof v !== 'number' || !Number.isInteger(v)) throw this.err(what + ' must be a whole number', n);
        return v;
      };
      const arity = (a, b) => {
        if (args.length < a || args.length > b) throw this.err('.' + name + '() takes ' + (a === b ? a : a + ' or ' + b) + ' argument(s)', n);
      };
      switch (k) {
        case 'length': arity(0, 0); return s.length;
        case 'substring': {
          arity(2, 2);
          const start = needInt(args[0], 'The start position');
          const len = needInt(args[1], 'The number of characters');
          if (start < 0 || start > s.length) throw this.err('substring start ' + start + ' is out of range for a string of length ' + s.length, n);
          if (len < 0) throw this.err('substring length cannot be negative', n);
          return s.substr(start, len);
        }
        case 'left': arity(1, 1); return s.slice(0, Math.max(0, needInt(args[0], 'n')));
        case 'right': { arity(1, 1); const r = needInt(args[0], 'n'); return r <= 0 ? '' : s.slice(-r); }
        case 'upper': case 'toupper': arity(0, 0); return s.toUpperCase();
        case 'lower': case 'tolower': arity(0, 0); return s.toLowerCase();
      }
      throw this.err("Strings have no method '" + name + "'. Available: .length, .substring(start, n), .left(n), .right(n), .upper, .lower", n);
    }

    fileMethod(file, name, args, n) {
      const k = name.toLowerCase();
      if (file.closed) throw this.err("The file '" + file.name + "' has already been closed", n);
      switch (k) {
        case 'readline':
          if (file.mode !== 'r') throw this.err("File '" + file.name + "' was opened with openWrite — use openRead to read it", n);
          if (file.pos >= file.lines.length) throw this.err("No more lines to read in '" + file.name + "' (use endOfFile() to check)", n);
          return file.lines[file.pos++];
        case 'endoffile':
          if (file.mode !== 'r') throw this.err("File '" + file.name + "' was opened with openWrite", n);
          return file.pos >= file.lines.length;
        case 'writeline':
          if (file.mode !== 'w') throw this.err("File '" + file.name + "' was opened with openRead — use openWrite to write to it", n);
          if (args.length !== 1) throw this.err('writeLine() takes 1 argument', n);
          file.lines.push(format(args[0]));
          this.flush(file, n);
          return undefined;
        case 'close':
          if (file.mode === 'w') this.flush(file, n);
          file.closed = true;
          return undefined;
      }
      throw this.err("Files have no method '" + name + "'. Available: readLine(), writeLine(text), endOfFile(), close()", n);
    }

    flush(file, n) {
      if (!this.fs) throw this.err('Files are not available here', n);
      this.fs.write(file.name, file.lines.map((l) => l + '\n').join(''));
    }

    openFile(args, mode, n) {
      if (!this.fs) throw this.err('Files are not available here', n);
      const name = args[0];
      if (typeof name !== 'string') throw this.err('The file name must be a string', n);
      if (mode === 'r') {
        const text = this.fs.read(name);
        if (text === null || text === undefined) throw this.err("File '" + name + "' does not exist", n);
        return new PFile(name, 'r', splitLines(text));
      }
      const f = new PFile(name, 'w', []);
      this.fs.write(name, '');
      return f;
    }
  }

  // ------------------------------------------------------------- builtins

  function toInt(v, n) {
    if (typeof v === 'number') return Math.trunc(v);
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
      if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Math.trunc(parseFloat(s));
    }
    throw this.err('int() cannot convert ' + typeName(v) + ' ' + format(v, true) + ' to an integer', n);
  }

  function toFloat(v, n) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return parseFloat(s);
    }
    throw this.err('float() cannot convert ' + typeName(v) + ' ' + format(v, true) + ' to a number', n);
  }

  const BUILTINS = {
    print: {
      proc: true,
      fn(args) { this.io.write(args.map((a) => format(a)).join(' ') + '\n'); },
    },
    input: {
      arity: [0, 1],
      async fn(args) {
        const v = await this.io.input(args.length ? format(args[0]) : '');
        if (this.stopped) throw new StopSignal();
        return v === null || v === undefined ? '' : String(v);
      },
    },
    str: { arity: [1, 1], fn(args) { return format(args[0]); } },
    int: { arity: [1, 1], fn(args, n) { return toInt.call(this, args[0], n); } },
    float: { arity: [1, 1], fn(args, n) { return toFloat.call(this, args[0], n); } },
    real: { arity: [1, 1], fn(args, n) { return toFloat.call(this, args[0], n); } },
    bool: {
      arity: [1, 1],
      fn(args, n) {
        const v = args[0];
        if (typeof v === 'boolean') return v;
        if (typeof v === 'string' && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === 'true';
        if (typeof v === 'number') return v !== 0;
        throw this.err('bool() cannot convert ' + format(v, true), n);
      },
    },
    asc: {
      arity: [1, 1],
      fn(args, n) {
        if (typeof args[0] !== 'string' || args[0].length !== 1) throw this.err('ASC() needs a single character', n);
        return args[0].charCodeAt(0);
      },
    },
    chr: {
      arity: [1, 1],
      fn(args, n) {
        if (typeof args[0] !== 'number' || !Number.isInteger(args[0])) throw this.err('CHR() needs a whole number', n);
        return String.fromCharCode(args[0]);
      },
    },
    len: {
      arity: [1, 1],
      fn(args, n) {
        if (typeof args[0] === 'string' || Array.isArray(args[0])) return args[0].length;
        throw this.err('len() needs a string or an array', n);
      },
    },
    random: {
      arity: [2, 2],
      fn(args, n) {
        const [a, b] = args;
        if (typeof a !== 'number' || typeof b !== 'number') throw this.err('random() needs two numbers', n);
        if (Number.isInteger(a) && Number.isInteger(b)) return a + Math.floor(this.random() * (b - a + 1));
        return a + this.random() * (b - a);
      },
    },
    round: {
      arity: [1, 2],
      fn(args, n) {
        const [x, d] = args;
        if (typeof x !== 'number') throw this.err('round() needs a number', n);
        const p = Math.pow(10, d || 0);
        return Math.round(x * p) / p;
      },
    },
    openread: { arity: [1, 1], fn(args, n) { return this.openFile(args, 'r', n); } },
    openwrite: { arity: [1, 1], fn(args, n) { return this.openFile(args, 'w', n); } },
    newfile: {
      proc: true,
      arity: [1, 1],
      fn(args, n) {
        if (!this.fs) throw this.err('Files are not available here', n);
        this.fs.write(String(args[0]), '');
      },
    },
  };

  return { tokenize, parse, Interpreter, PseudoError, StopSignal, format, KEYWORDS, BUILTINS };
});
