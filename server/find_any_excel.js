const fs = require('fs');
const path = require('path');

function getFilesRecursively(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath));
    } else {
      results.push(fullPath);
    }
  });
  return results;
}

try {
  const allFiles = getFilesRecursively('/Users/macair/Downloads/Vouch AI');
  console.log("All files in Vouch AI folder:");
  allFiles.forEach(f => console.log(f));
} catch (err) {
  console.error("Error listing Vouch AI recursively:", err);
}
