# OCR Pseudocode Runner

可以**运行** OCR A Level Computer Science (H046/H446) 官方《Pseudocode Guide》标准伪代码的解释器。

- 纯 JavaScript 实现（自己的词法分析器 + 语法分析器 + 解释器，不是把伪代码正则替换成 Python）
- 浏览器里直接用：编辑器带语法高亮、自动缩进，`input()` 在输出窗口里直接输入，文件读写有虚拟文件面板
- 也可以在命令行用 Node.js 运行 `.txt` 程序
- 报错会指出**第几行**，并给出提示（例如 `"Score: " + score` 会提示你用 `str()`）

## 使用方法

### 网页版

- **本地**：直接双击打开 `index.html` 即可（不需要服务器、不需要联网，联网只是为了加载字体）。
- **GitHub Pages**：仓库 Settings → Pages → 选择包含这些文件的分支和 `/ (root)`，之后访问 Pages 地址即可。

快捷键：`Ctrl+Enter` 运行，`Esc` 停止，`Tab` / `Shift+Tab` 缩进 / 反缩进。代码自动保存在浏览器里。

### 命令行

```bash
node cli/ocr.js myprogram.txt
```

`input()` 从键盘读入，`openRead/openWrite` 读写与程序同目录下的真实文件。

### 测试

```bash
node tests/run-tests.js
```

## 支持的语法（与官方 Guide 对应）

| Guide 章节 | 写法 |
|---|---|
| Variables | `x = 3`，`name = "Bob"`，`global userid = 123` |
| Casting | `str(3)`，`int("3")`，`float("3.14")`（另有 `real()`、`bool()`） |
| Output / Input | `print("hello")`，`name = input("Please enter your name")` |
| Count controlled | `for i=0 to 7` … `next i`（支持 `step -1`） |
| Condition controlled | `while … endwhile`，`do … until 条件` |
| Logical operators | `AND OR NOT` |
| Comparison | `== != < <= > >=` |
| Arithmetic | `+ - * /`，`MOD`，`DIV`，`^`（`12MOD5` 这种不加空格的写法也行） |
| Selection | `if … then / elseif … then / else / endif`，`switch x: / case "A": / default: / endswitch` |
| String handling | `s.length`，`s.substring(start, n)`（从 0 开始）；另有 `.upper .lower .left(n) .right(n)`、`ASC()`、`CHR()` |
| Subroutines | `function … return … endfunction`，`procedure … endprocedure`，`x:byVal`、`y:byRef` |
| Arrays | `array names[5]`，`array board[8,8]`，`board[0,0] = "rook"`，下标从 0 开始；也支持 `array a = [1,2,3]` |
| Files | `openRead`，`readLine()`，`endOfFile()`，`openWrite`，`writeLine()`，`close()` |
| Comments | `// 注释` |
| OOP | `class … endclass`，`public` / `private`，构造函数 `procedure new(...)`，`inherits`，`super.new(...)`，`super.method()`，`new ClassName(...)` |

额外的便利：`random(1,6)`（两端都包含）、`len()`、`round(x, 2)`。

### 语义细节

- 关键字不区分大小写（`IF`、`Endif`、`NEXT i` 都可以），**变量名区分大小写**。
- 从 PDF 里复制出来的弯引号 `“ ”` 会被自动识别为普通引号。
- 也接受 `end if`、`else if`、`endfor`、`<>` 这些常见变体；条件里的单个 `=` 也会被当作比较。
- 默认**按值传递**（byVal），连数组也会复制一份。想让子程序修改传入的数组/变量，请写 `:byRef`。
- 子程序里的变量是局部的；主程序的变量在子程序里可以读取，但要在子程序里修改它，必须在主程序里用 `global` 声明。
- `/` 总是普通除法（`7/2` 得 `3.5`），`DIV` 是整除，`MOD` 是取余（负数时与 Python 一致）。
- 字符串和数字不能直接用 `+` 拼接，要用 `str()`，这跟考试里的要求一致。
- `private` 的属性和方法从类外访问会报错。
- 条件必须是 true/false，用数字当条件会报错。
- 递归超过 3000 层会报 “Stack overflow”。

## 文件结构

```
index.html           网页界面
css/style.css
js/interpreter.js    解释器（浏览器和 Node 共用）
js/examples.js       示例程序（排序、查找、栈、队列、链表、OOP…）
js/app.js            网页界面逻辑（编辑器、输出、文件面板）
cli/ocr.js           命令行入口
tests/run-tests.js   测试
```
