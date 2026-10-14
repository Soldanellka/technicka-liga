// scripts/csv-to-json.js
const fs = require('fs')
const path = require('path')
const csvParse = require('csv-parse/lib/sync')

const [,, input, output] = process.argv
if(!input || !output){ console.error('Usage: node scripts/csv-to-json.js input.csv output.json'); process.exit(1) }

const raw = fs.readFileSync(path.resolve(input), 'utf8')
const records = csvParse(raw, { columns: true, skip_empty_lines: true })

const questions = records.map(r=>{
  return {
    q: r.q,
    options: [r.option1, r.option2, r.option3].filter(Boolean),
    correct: Number(r.correctIndex || 0),
    approved: (r.approved === 'true' || r.approved === '1') ? true : false
  }
})

fs.writeFileSync(path.resolve(output), JSON.stringify(questions, null, 2))
console.log(`Wrote ${questions.length} questions to ${output}`)
