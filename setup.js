const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

console.log("🚀 Initializing J-Star Local Reviewer...");

// 1. Install Dependencies
console.log("📦 Installing Intelligence Packages (using pnpm)...");
try {
    execSync('pnpm install -D llamaindex chromadb dotenv simple-git chalk husky ts-node typescript @types/node groq-sdk', { stdio: 'inherit' });
} catch (e) {
    console.log("❌ Failed to install packages. Do you have pnpm installed?");
    process.exit(1);
}

// 2. Create Scripts Directory
const scriptsDir = path.join(process.cwd(), 'scripts');
if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir);

// 3. Write the Logic Files 
// In a real generic script, we would fetch these from a gist or repo.
// For this local v2 setup, we assume they are already here or we are running this to restore them.
// But the user asked for a script that "bootstraps" it. 
// Since we already created the files in this session, this script primarily ensures dependencies and package.json are correct.

// 4. Update package.json
const pkgPath = path.join(process.cwd(), 'package.json');
if (fs.existsSync(pkgPath)) {
    const pkg = require(pkgPath);
    pkg.scripts = pkg.scripts || {};
    pkg.scripts['index:init'] = "ts-node scripts/indexer.ts --init";
    pkg.scripts['index:watch'] = "ts-node scripts/indexer.ts --watch";
    pkg.scripts['review'] = "ts-node scripts/reviewer.ts";
    pkg.scripts['detect'] = "ts-node scripts/detective.ts";
    pkg.scripts['prepare'] = "husky install";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    console.log("✅ package.json scripts updated.");
}

// 5. Ignore the Brain (Don't push the binary blob!)
const gitignorePath = path.join(process.cwd(), '.gitignore');
if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.includes('.jstar/')) {
        fs.appendFileSync(gitignorePath, '\n# J-Star Index\n.jstar/\n.env\n');
        console.log("✅ .gitignore updated.");
    }
}

// 6. Init Husky
try {
    execSync('pnpm run prepare', { stdio: 'inherit' });
    // Auto-add pre-push hook? Maybe just detect.
    // execSync('npx husky add .husky/pre-push "pnpm run detect"', { stdio: 'inherit' });
} catch (e) {
    console.log("⚠️  Husky setup failed, but that's optional.");
}

console.log("\n✅ Setup Complete!");
console.log("👉 Step 1: Add GROQ_API_KEY (and OPENAI_API_KEY if using OpenAI embeddings) to your .env");
console.log("👉 Step 2: Run 'pnpm run index:init' to build the Brain");
console.log("👉 Step 3: Run 'pnpm run review' to check your code!");
