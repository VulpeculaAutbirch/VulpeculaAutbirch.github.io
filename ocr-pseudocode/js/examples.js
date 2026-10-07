// Example programs written in OCR A Level pseudocode.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OCR_EXAMPLES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return [
    {
      title: '入门 Hello World & 输入',
      testInputs: ['Hamish', '17'],
      code: `// 注释用 //
print("Hello World")

name = input("What is your name? ")
age = int(input("How old are you? "))
print("Hello " + name + ", next year you will be " + str(age + 1))
`,
    },
    {
      title: '运算符 Operators',
      expect: '11\n1\n24\n6\n2\n3\n81\n3.5\ntrue\nfalse\n',
      code: `print(6+5)      // 11
print(6-5)      // 1
print(12*2)     // 24
print(12/2)     // 6
print(12 MOD 5) // 2  余数
print(17 DIV 5) // 3  整除
print(3^4)      // 81 乘方
print(7/2)      // 3.5

x = 4
flag = false
print(x <= 5 AND flag == false)
print(NOT (x == 4))
`,
    },
    {
      title: '循环 Iteration (for / while / do-until)',
      testInputs: ['abc', 'computer', 'computer'],
      code: `for i=0 to 7
    print("Hello " + str(i))
next i

for i = 10 to 0 step -2
    print(i)
next i

answer = ""
while answer != "computer"
    answer = input("What is the password? ")
endwhile

do
    answer = input("What is the password? ")
until answer == "computer"
print("Access granted")
`,
    },
    {
      title: '选择 Selection (if / switch)',
      testInputs: ['B'],
      code: `entry = input("Enter A, B or C: ")

if entry == "A" then
    print("You selected A")
elseif entry == "B" then
    print("You selected B")
else
    print("Unrecognised selection")
endif

switch entry:
    case "A":
        print("You selected A")
    case "B":
        print("You selected B")
    default:
        print("Unrecognised selection")
endswitch
`,
    },
    {
      title: '字符串 String handling',
      code: `someText = "Computer Science"
print(someText.length)          // 16
print(someText.substring(3,3))  // put  (从第0个字符开始数)
print(someText.upper)
print(someText.lower)
print(someText.left(8))
print(someText.right(7))
print(ASC("A"))                 // 65
print(CHR(97))                  // a

// 逐个字符遍历
reversed = ""
for i = 0 to someText.length - 1
    reversed = someText.substring(i, 1) + reversed
next i
print(reversed)
`,
    },
    {
      title: '子程序 Functions & procedures, byVal/byRef',
      code: `function triple(number)
    return number*3
endfunction

procedure greeting(name)
    print("hello " + name)
endprocedure

y = triple(7)
print(y)
greeting("Hamish")

// x 按值传递 (byVal)，y 按引用传递 (byRef)
procedure foobar(x:byVal, y:byRef)
    x = x + 100
    y = y + 100
endprocedure

a = 1
b = 1
foobar(a, b)
print("a = " + str(a))   // 1   不变
print("b = " + str(b))   // 101 被修改

procedure swap(p:byRef, q:byRef)
    temp = p
    p = q
    q = temp
endprocedure

array nums = [5, 9]
swap(nums[0], nums[1])
print(nums)
`,
    },
    {
      title: '全局变量 global',
      code: `global score = 0

procedure addPoints(n)
    score = score + n     // 修改的是全局变量
endprocedure

procedure tryLocal()
    count = 99            // 局部变量，函数结束后消失
endprocedure

count = 1
addPoints(10)
addPoints(5)
tryLocal()
print(score)   // 15
print(count)   // 1
`,
    },
    {
      title: '数组 Arrays (1D & 2D)',
      code: `array names[5]
names[0]="Ahmad"
names[1]="Ben"
names[2]="Catherine"
names[3]="Dana"
names[4]="Elijah"

print(names[3])
print(names)

array board[8,8]
board[0,0]="rook"
print(board[0,0])

// 3x3 乘法表
array table[3,3]
for r = 0 to 2
    for c = 0 to 2
        table[r,c] = (r+1)*(c+1)
    next c
next r
for r = 0 to 2
    line = ""
    for c = 0 to 2
        line = line + str(table[r,c]) + " "
    next c
    print(line)
next r
`,
    },
    {
      title: '文件 Reading & writing files',
      files: {},
      code: `// 文件保存在右侧「文件」面板里
myFile = openWrite("sample.txt")
myFile.writeLine("Hello World")
myFile.writeLine("This is line 2")
myFile.writeLine("This is line 3")
myFile.close()

myFile = openRead("sample.txt")
x = myFile.readLine()
myFile.close()
print("First line: " + x)

myFile = openRead("sample.txt")
while NOT myFile.endOfFile()
    print(myFile.readLine())
endwhile
myFile.close()
`,
    },
    {
      title: '面向对象 Classes & inheritance',
      code: `class Pet
    private name
    public procedure new(givenName)
        name = givenName
    endprocedure

    public function getName()
        return name
    endfunction

    public function speak()
        return "..."
    endfunction
endclass

class Dog inherits Pet
    private breed
    public procedure new(givenName, givenBreed)
        super.new(givenName)
        breed = givenBreed
    endprocedure

    public function speak()
        return "Woof! I am " + getName() + " the " + breed
    endfunction
endclass

myDog = new Dog("Fido", "Scottish Terrier")
myPet = new Pet("Generic")
print(myDog.speak())
print(myPet.speak())
print(myDog.getName())
// print(myDog.breed)   // 去掉注释试试：breed 是 private，会报错
`,
    },
    {
      title: '面向对象 Getters/Setters (Player)',
      code: `class Player
    private attempts = 3

    public procedure setAttempts(number)
        attempts = number
    endprocedure

    public function getAttempts()
        return attempts
    endfunction
endclass

player = new Player()
print(player.getAttempts())
player.setAttempts(5)
print(player.getAttempts())
`,
    },
    {
      title: '算法 Bubble sort',
      expect: '[1, 2, 3, 5, 8, 9]\n',
      code: `procedure bubbleSort(items:byRef)
    n = items.length
    do
        swapped = false
        for i = 0 to n - 2
            if items[i] > items[i+1] then
                temp = items[i]
                items[i] = items[i+1]
                items[i+1] = temp
                swapped = true
            endif
        next i
        n = n - 1
    until swapped == false
endprocedure

array nums = [5, 1, 9, 3, 8, 2]
bubbleSort(nums)
print(nums)
`,
    },
    {
      title: '算法 Insertion sort',
      expect: '[1, 2, 3, 5, 8, 9]\n',
      code: `procedure insertionSort(list:byRef)
    for i = 1 to list.length - 1
        current = list[i]
        pos = i
        while pos > 0 AND list[pos-1] > current
            list[pos] = list[pos-1]
            pos = pos - 1
        endwhile
        list[pos] = current
    next i
endprocedure

array nums = [5, 1, 9, 3, 8, 2]
insertionSort(nums)
print(nums)
`,
    },
    {
      title: '算法 Merge sort (递归)',
      expect: '[1, 2, 3, 5, 8, 9, 12]\n',
      code: `function mergeSort(list)
    if list.length <= 1 then
        return list
    endif
    mid = list.length DIV 2
    array left[mid]
    array right[list.length - mid]
    for i = 0 to mid - 1
        left[i] = list[i]
    next i
    for i = mid to list.length - 1
        right[i - mid] = list[i]
    next i
    return merge(mergeSort(left), mergeSort(right))
endfunction

function merge(a, b)
    array result[a.length + b.length]
    i = 0
    j = 0
    k = 0
    while i < a.length AND j < b.length
        if a[i] <= b[j] then
            result[k] = a[i]
            i = i + 1
        else
            result[k] = b[j]
            j = j + 1
        endif
        k = k + 1
    endwhile
    while i < a.length
        result[k] = a[i]
        i = i + 1
        k = k + 1
    endwhile
    while j < b.length
        result[k] = b[j]
        j = j + 1
        k = k + 1
    endwhile
    return result
endfunction

array nums = [12, 5, 1, 9, 3, 8, 2]
print(mergeSort(nums))
`,
    },
    {
      title: '算法 Binary search',
      expect: 'Found at index 5\nNot found\n',
      code: `function binarySearch(list, target)
    low = 0
    high = list.length - 1
    while low <= high
        mid = (low + high) DIV 2
        if list[mid] == target then
            return mid
        elseif list[mid] < target then
            low = mid + 1
        else
            high = mid - 1
        endif
    endwhile
    return -1
endfunction

array data = [2, 5, 8, 12, 16, 23, 38, 56, 72, 91]
pos = binarySearch(data, 23)
if pos != -1 then
    print("Found at index " + str(pos))
endif
if binarySearch(data, 7) == -1 then
    print("Not found")
endif
`,
    },
    {
      title: '递归 Recursion (factorial, Fibonacci)',
      code: `function factorial(n)
    if n <= 1 then
        return 1
    else
        return n * factorial(n - 1)
    endif
endfunction

function fib(n)
    if n < 2 then
        return n
    endif
    return fib(n-1) + fib(n-2)
endfunction

print(factorial(10))
for i = 0 to 10
    print(fib(i))
next i
`,
    },
    {
      title: '数据结构 Stack (class)',
      expect: '30\n20\nStack empty\n',
      code: `class Stack
    private array items[10]
    private top = -1

    public procedure push(value)
        if top == items.length - 1 then
            print("Stack full")
        else
            top = top + 1
            items[top] = value
        endif
    endprocedure

    public function pop()
        if isEmpty() then
            return null
        endif
        value = items[top]
        top = top - 1
        return value
    endfunction

    public function isEmpty()
        return top == -1
    endfunction
endclass

s = new Stack()
s.push(10)
s.push(20)
s.push(30)
print(s.pop())
print(s.pop())
s.pop()
if s.isEmpty() then
    print("Stack empty")
endif
`,
    },
    {
      title: '数据结构 Circular queue',
      expect: 'A\nB\nC\nD\n',
      code: `class Queue
    private array items[3]
    private front = 0
    private rear = -1
    private size = 0

    public procedure enqueue(value)
        if size == items.length then
            print("Queue full")
        else
            rear = (rear + 1) MOD items.length
            items[rear] = value
            size = size + 1
        endif
    endprocedure

    public function dequeue()
        value = items[front]
        front = (front + 1) MOD items.length
        size = size - 1
        return value
    endfunction
endclass

q = new Queue()
q.enqueue("A")
q.enqueue("B")
print(q.dequeue())
q.enqueue("C")
q.enqueue("D")
print(q.dequeue())
print(q.dequeue())
print(q.dequeue())
`,
    },
    {
      title: '数据结构 Linked list',
      expect: 'apple\nbanana\ncherry\n',
      code: `class Node
    public data
    public next
    public procedure new(givenData)
        data = givenData
        next = null
    endprocedure
endclass

class LinkedList
    private head = null

    public procedure append(value)
        newNode = new Node(value)
        if head == null then
            head = newNode
        else
            current = head
            while current.next != null
                current = current.next
            endwhile
            current.next = newNode
        endif
    endprocedure

    public procedure display()
        current = head
        while current != null
            print(current.data)
            current = current.next
        endwhile
    endprocedure
endclass

list = new LinkedList()
list.append("apple")
list.append("banana")
list.append("cherry")
list.display()
`,
    },
    {
      title: '小游戏 Guess the number',
      testInputs: ['50', '1'],
      code: `target = random(1, 100)
guesses = 0
do
    guess = int(input("Guess a number 1-100: "))
    guesses = guesses + 1
    if guess > target then
        print("Too high")
    elseif guess < target then
        print("Too low")
    endif
until guess == target
print("Correct! You took " + str(guesses) + " guesses")
`,
    },
  ];
});
