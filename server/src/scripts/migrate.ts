import { loadConfig } from '../config.js'
import { openDb } from '../db/index.js'

const config = loadConfig()
const db = openDb(config.DATABASE_URL)
console.log(`Database ready at ${config.DATABASE_URL}`)
db.close()
