import json
from pathlib import Path

p = Path(r"C:\Users\youso\.openclaw\workspace\IQ Test\data\questionBank.json")
data = json.loads(p.read_text(encoding="utf-8"))

expected = {
1:'fuel source',2:'rotation',3:'succession',4:'horseshoes',5:'stingy',6:'older',7:'daughter-in-law',8:'F',9:'familiar',10:'competitors',11:'a cooler',12:'20',13:'difficult to produce',14:'artificial',15:'L',16:'walk',17:'congregation',18:'rise',19:'D',20:'thousand',21:'81',22:'time',23:'75',24:'client',25:'Uncertain',26:'I',27:'$18.50',28:'tolerant',29:'roots',30:'27',31:'ray',32:'through',33:'D',34:'240',35:'king, queen',36:'yesterday',37:'False',38:'brindo',39:'fear',40:'particular',41:'a',42:'absurd',43:'True',44:'daftness',45:'exclusive',46:'congress',47:'ordinary',48:'an island',49:'m',50:'I',51:'Uncertain',52:'disingenuous',53:'obscure',54:'G',55:'1',56:'roll',57:'1',58:'17',59:'$7.00',60:'unless',61:'C',62:'m',63:'repudiate',64:'cause',65:'exorbitant',66:'soot',67:'31',68:'9',69:'slowly',70:'45',71:'physiology',72:'22 1/2 cm',73:'A',74:'Uncertain',75:'dark, light',76:'m',77:'4',78:'2',79:'4',80:'12 m'
}

mismatches = []
for question in data:
    number = int(question['id'].split('-')[1])
    exp = expected[number].strip().lower()
    idx = question['answerIndex']
    actual = question['options'][idx].strip().lower() if idx < len(question['options']) else '<out-of-range>'
    if actual != exp:
        mismatches.append({
            'number': number,
            'expected': expected[number],
            'actual': question['options'][idx] if idx < len(question['options']) else '<out-of-range>',
            'options': question['options'],
            'answerIndex': idx,
        })

print(json.dumps({'total': len(data), 'mismatches': mismatches}, indent=2))
