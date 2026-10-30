# Records demo/demo.gif. Run from the repository root: vhs demo/demo.tape

Output demo/demo.gif

Set Shell "bash"
Set FontSize 15
Set Width 1240
Set Height 720
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 35ms

Hide
Type "cd examples/payment-api && export PS1='$ ' && clear"
Enter
Show

Type "# A checkout endpoint written the way AI agents usually write it. Tests pass."
Enter
Sleep 600ms
Type "sed -n '30,46p' before.py"
Enter
Sleep 4s

Type "clear"
Enter
Type "# The scar-tissue audit of that file:"
Enter
Sleep 400ms
Type "node ../../skills/scar-tissue/validate-findings.cjs scar-tissue-report.json --format text --color | head -30"
Enter
Sleep 9s

Type "clear"
Enter
Type "node ../../skills/scar-tissue/validate-findings.cjs scar-tissue-report.json --format text --color | tail -1"
Enter
Sleep 4s
