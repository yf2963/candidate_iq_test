import json
from pathlib import Path

p = Path(r"C:\Users\youso\.openclaw\workspace\IQ Test\data\questionBank.json")
data = json.loads(p.read_text(encoding="utf-8"))

fixes = {
    38: {
        "prompt": "Franco is to flanco as ___ is to blindo.",
        "options": ["brinco", "brindo", "lindo", "blanco", "pliso"],
        "answerIndex": 1,
    },
    60: {
        "prompt": "Which of the following words can correctly begin this sentence? ⇒ \"___ it's cloudy, the moon will be seen tonight.\"",
        "options": ["if", "since", "as", "because", "unless"],
        "answerIndex": 4,
    },
    62: {
        "prompt": "Rearrange the following words to form the best possible sentence. With which letter does the sixth word begin? ⇒ money it to make important is friend than more a",
        "options": ["d", "q", "i", "t", "m"],
        "answerIndex": 4,
    },
    73: {
        "prompt": "The first figure relates to the second in the same way that the third figure relates to one of the options. Which option completes the analogy?",
        "options": ["A", "B", "C", "D"],
        "answerIndex": 0,
    },
    76: {
        "prompt": "Rearrange the following words to form the best possible sentence. With which letter does the second word begin? ⇒ more money while working more man earns a",
        "options": ["w", "m", "a", "e", "d"],
        "answerIndex": 1,
    },
    27: {
        "answerIndex": 1,
    },
    59: {
        "answerIndex": 3,
    },
    72: {
        "options": ["21 cm", "22 1/2 cm", "23 3/5 cm", "24 cm", "25 cm"],
        "answerIndex": 1,
    },
    41: {
        "prompt": "In the following number series, what letter comes next?  A C F J O ?",
        "options": ["A", "G", "M", "T", "I"],
        "answerIndex": 0,
    },
    80: {
        "prompt": "A 20 meter rope is cut into two parts so that one part is ⅔ the length of the other. How long is the longer part?",
        "options": ["13 1/3 m", "10 m", "15 m", "16 m", "12 m"],
        "answerIndex": 4,
    },
}

for question in data:
    number = int(question["id"].split("-")[1])
    if number in fixes:
        question.update(fixes[number])

p.write_text(json.dumps(data, indent=2), encoding="utf-8")
print("patched question bank")
