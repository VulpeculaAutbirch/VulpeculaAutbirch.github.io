// node tests/run-tests.js
'use strict';

const { Interpreter, PseudoError } = require('../js/interpreter.js');
const EXAMPLES = require('../js/examples.js');

async function run(src, inputs, files) {
  let out = '';
  inputs = (inputs || []).slice();
  const store = Object.assign({}, files || {});
  const io = {
    write: (t) => { out += t; },
    input: async (p) => { out += p; const v = inputs.shift(); out += (v === undefined ? '' : v) + '\n'; return v; },
  };
  const fs = { read: (n) => (n in store ? store[n] : null), write: (n, t) => { store[n] = t; } };
  let error = null;
  try {
    await new Interpreter({ io, fs, random: () => 0 }).run(src);
  } catch (e) {
    if (!(e instanceof PseudoError)) throw e;
    error = e;
  }
  return { out, error, files: store };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, msg) => {
  if (a !== b) throw new Error((msg || 'mismatch') + '\n  expected: ' + JSON.stringify(b) + '\n  actual:   ' + JSON.stringify(a));
};
const outIs = (src, expected, inputs, files) => async () => {
  const r = await run(src, inputs, files);
  if (r.error) throw new Error('unexpected error: ' + r.error.toString());
  eq(r.out, expected);
};
const errIs = (src, re, line) => async () => {
  const r = await run(src);
  if (!r.error) throw new Error('expected an error, got output ' + JSON.stringify(r.out));
  if (!re.test(r.error.message)) throw new Error('error message ' + JSON.stringify(r.error.message) + ' does not match ' + re);
  if (line !== undefined) eq(r.error.line, line, 'error line');
};

// ---- examples straight from the OCR guide
test('variables & casting', outIs('x=3\nname=“Bob”\nprint(str(3))\nprint(int(“3”)+1)\nprint(float(“3.14”))\nprint(name)', '3\n4\n3.14\nBob\n'));
test('for loop 0..7', outIs('for i=0 to 7\n    print(“Hello”)\nnext i', 'Hello\n'.repeat(8)));
test('while / do-until with input', outIs(
  'answer=""\nwhile answer!=“computer”\n answer=input(“What is the password?”)\nendwhile\ndo\n answer=input(“pw?”)\nuntil answer==“computer”',
  'What is the password?x\nWhat is the password?computer\npw?computer\n', ['x', 'computer', 'computer']));
test('global uninitialised answer in while', errIs('while answer!="x"\nendwhile', /answer/, 1));
test('arithmetic', outIs('print(6+5)\nprint(6-5)\nprint(12*2)\nprint(12/2)\nprint(12MOD5)\nprint(17DIV5)\nprint(3^4)\nprint(7/2)', '11\n1\n24\n6\n2\n3\n81\n3.5\n'));
test('MOD/DIV negatives (floor)', outIs('print(-7 MOD 3)\nprint(-7 DIV 2)', '2\n-4\n'));
test('precedence', outIs('print(2+3*4)\nprint((2+3)*4)\nprint(-2^2)\nprint(2^3^2)\nprint(NOT 1==2 AND true)', '14\n20\n-4\n512\ntrue\n'));
test('if/elseif/else', outIs(
  'entry="b"\nif entry==“a” then\n    print(“You selected A”)\nelseif entry==“b” then\n    print(“You selected B”)\nelse\n    print(“Unrecognised selection”)\nendif',
  'You selected B\n'));
test('else if (two words) and end if', outIs('x=3\nif x==1 then\n print(1)\nelse if x==3 then\n print(3)\nend if', '3\n'));
test('switch', outIs(
  'entry="C"\nswitch entry:\n    case “A”:\n        print(“You selected A”)\n    case “B”:\n        print(“You selected B”)\n    default:\n        print(“Unrecognised selection”)\nendswitch',
  'Unrecognised selection\n'));
test('string handling', outIs('someText=“Computer Science”\nprint(someText.length)\nprint(someText.substring(3,3))\nprint(someText.subString(0,8))\nprint(someText.upper)\nprint(someText.left(3) + someText.right(3))', '16\nput\nComputer\nCOMPUTER SCIENCE\nComnce\n'));
test('functions & procedures', outIs(
  'function triple(number)\n    return number*3\nendfunction\nprocedure greeting(name)\n    print(“hello”+name)\nendprocedure\ny=triple(7)\nprint(y)\ngreeting(“Hamish”)',
  '21\nhelloHamish\n'));
test('byVal / byRef', outIs(
  'procedure foobar(x:byVal, y:byRef)\n    x = x + 1\n    y = y + 1\nendprocedure\na=1\nb=1\nfoobar(a, b)\nprint(a)\nprint(b)',
  '1\n2\n'));
test('byRef array element and byVal array copy', outIs(
  'procedure inc(v:byRef)\n v = v + 10\nendprocedure\nprocedure clear(arr)\n arr[0] = 0\nendprocedure\nprocedure clearRef(arr:byRef)\n arr[0] = 0\nendprocedure\narray a = [1,2,3]\ninc(a[1])\nclear(a)\nprint(a)\nclearRef(a)\nprint(a)',
  '[1, 12, 3]\n[0, 12, 3]\n'));
test('arrays 1D and 2D', outIs(
  'array names[5]\nnames[0]=“Ahmad”\nnames[1]=“Ben”\nnames[2]=“Catherine”\nnames[3]=“Dana”\nnames[4]=“Elijah”\nprint(names[3])\nArray board[8,8]\nboard[0,0]=“rook”\nprint(board[0,0])\nprint(board[0][0])\nprint(names.length)',
  'Dana\nrook\nrook\n5\n'));
test('array out of range', errIs('array a[5]\na[5]=1', /out of range.*0 to 4/, 2));
test('files', async () => {
  const r = await run(
    'myFile = openWrite(“sample.txt”)\nmyFile.writeLine(“Hello World”)\nmyFile.writeLine(“Line 2”)\nmyFile.close()\n' +
    'myFile = openRead(“sample.txt”)\nx = myFile.readLine()\nprint(x)\nmyFile.close()\n' +
    'myFile = openRead(“sample.txt”)\nwhile NOT myFile.endOfFile()\n    print(myFile.readLine())\nendwhile\nmyFile.close()');
  if (r.error) throw new Error(r.error.toString());
  eq(r.out, 'Hello World\nHello World\nLine 2\n');
  eq(r.files['sample.txt'], 'Hello World\nLine 2\n');
});
test('comments', outIs('print(“Hello World”) //This is a comment\n// whole line', 'Hello World\n'));
test('OOP methods & attributes', outIs(
  'class Player\n    private attempts = 3\n    public procedure setAttempts(number)\n        attempts=number\n    endprocedure\n    public function getAttempts()\n        return attempts\n    endfunction\nendclass\nplayer = new Player()\nprint(player.getAttempts())\nplayer.setAttempts(5)\nprint(player.getAttempts())',
  '3\n5\n'));
test('private method / attribute blocked from outside', errIs(
  'class P\n private x = 1\n private function f()\n  return x\n endfunction\nendclass\np = new P()\nprint(p.x)', /private/, 8));
test('private method blocked', errIs(
  'class P\n private function f()\n  return 1\n endfunction\nendclass\np = new P()\nprint(p.f())', /private/, 7));
test('constructors & inheritance', outIs(
  'class Pet\n        private name\n        public procedure new(givenName)\n            name=givenName\n        endprocedure\n        public function getName()\n            return name\n        endfunction\nendclass\n' +
  'class Dog inherits Pet\n    private breed\n    public procedure new(givenName, givenBreed)\n        super.new(givenName)\n        breed=givenBreed\n    endprocedure\n    public function describe()\n        return getName() + " is a " + breed\n    endfunction\nendclass\n' +
  'myDog = new Dog(“Fido”,”Scottish Terrier”)\nprint(myDog.describe())\nprint(myDog.getName())',
  'Fido is a Scottish Terrier\nFido\n'));
test('method override + super call', outIs(
  'class A\n public function speak()\n  return "A"\n endfunction\nendclass\nclass B inherits A\n public function speak()\n  return "B" + super.speak()\n endfunction\nendclass\nb = new B()\nprint(b.speak())',
  'BA\n'));
test('global keyword', outIs(
  'global total = 0\nprocedure add(n)\n    total = total + n\nendprocedure\nadd(5)\nadd(7)\nprint(total)', '12\n'));
test('local variables do not leak', outIs(
  'x = 1\nprocedure p()\n    x = 99\nendprocedure\np()\nprint(x)', '1\n'));
test('recursion', outIs(
  'function fact(n)\n if n <= 1 then\n  return 1\n else\n  return n * fact(n-1)\n endif\nendfunction\nprint(fact(10))', '3628800\n'));
test('deep recursion -> stack overflow message', errIs('function f(n)\n return f(n+1)\nendfunction\nprint(f(1))', /Stack overflow/));
test('for with step & next without var', outIs('for i = 10 to 0 step -5\n print(i)\nnext', '10\n5\n0\n'));
test('linked list with .next attribute', outIs(
  'class Node\n public data\n public next\n public procedure new(d)\n  data = d\n  next = null\n endprocedure\nendclass\nhead = new Node(1)\nhead.next = new Node(2)\nn = head\nwhile n != null\n print(n.data)\n n = n.next\nendwhile',
  '1\n2\n'));
test('string + number error hints str()', errIs('score = 5\nprint("Score: " + score)', /str\(\)/, 2));
test('procedure used as value', errIs('procedure p()\nendprocedure\nx = p()', /procedure/, 3));
test('function without return', errIs('function f()\n x = 1\nendfunction\ny = f()', /without returning/));
test('missing endif', errIs('if true then\n print(1)\nprint(2)', /endif.*line 1/));
test('missing next', errIs('for i=1 to 3\n print(i)\n', /next i/));
test('mismatched next', errIs('for i=1 to 3\nnext j', /does not match/, 2));
test('undefined variable suggestion', errIs('Total = 1\nprint(total)', /Did you mean 'Total'/, 2));
test('== used for assignment', errIs('x == 5', /single '='/, 1));
test('= accepted as comparison in conditions', outIs('x = 5\nif x = 5 then\n print("yes")\nendif', 'yes\n'));
test('case-insensitive keywords', outIs('FOR i = 1 TO 2\n  IF i MOD 2 == 0 THEN\n    PRINT("even")\n  ELSE\n    print("odd")\n  ENDIF\nNEXT i', 'odd\neven\n'));
test('ASC / CHR / random / bool', outIs('print(ASC("A"))\nprint(CHR(66))\nprint(random(1,6))\nprint(bool("True"))', '65\nB\n1\ntrue\n'));
test('print arrays and booleans', outIs('array a = ["x", 1, true]\nprint(a)\nprint(1 < 2)', '["x", 1, true]\ntrue\n'));
test('functions defined after use (hoisting)', outIs('print(sq(4))\nfunction sq(n)\n return n*n\nendfunction', '16\n'));
test('condition must be boolean', errIs('if 1 then\nendif', /true or false/, 1));
test('int conversion error', errIs('x = int("abc")', /int\(\)/, 1));

// ---- every built-in example must run without errors
for (const ex of EXAMPLES) {
  test('example: ' + ex.title, async () => {
    const r = await run(ex.code, ex.testInputs || ['5', '3', '7', 'computer', 'q', 'q', 'q'], ex.files);
    if (r.error) throw new Error(r.error.toString() + '\n' + r.out);
    if (ex.expect !== undefined) eq(r.out, ex.expect);
  });
}

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log('  ok   ' + t.name);
    } catch (e) {
      failed++;
      console.log('  FAIL ' + t.name + '\n       ' + String(e.message).replace(/\n/g, '\n       '));
    }
  }
  console.log('\n' + (tests.length - failed) + '/' + tests.length + ' passed');
  process.exitCode = failed ? 1 : 0;
})();
