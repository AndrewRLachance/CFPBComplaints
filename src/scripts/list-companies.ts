import { createDatabase, createRepositories } from '../index.js';
import { companies } from '../db/schema.js';

// Usage: tsx src/scripts/list-companies.ts [optional-db-path]
const { db, close } = createDatabase(process.argv[2] ? { path: process.argv[2] } : {});

try {
	for (const { name } of createRepositories(db).companies.findMany({ orderBy: companies.name })) {
		console.log(name);
	}
} finally {
	close();
}
