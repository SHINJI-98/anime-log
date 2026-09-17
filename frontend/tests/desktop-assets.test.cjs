const fs = require('fs')
const path = require('path')

const indexPath = path.resolve(__dirname, '..', 'dist', 'index.html')
const html = fs.readFileSync(indexPath, 'utf8')

const absoluteAssetPattern = /\s(?:src|href)="\/assets\//
if (absoluteAssetPattern.test(html)) {
  throw new Error('Desktop build must use relative ./assets paths so file:// Electron pages can load JS and CSS.')
}

const assetReferences = [...html.matchAll(/\s(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((match) => match[1])
if (assetReferences.length === 0) {
  throw new Error('No built asset references were found in dist/index.html.')
}

for (const reference of assetReferences) {
  if (!reference.startsWith('./assets/')) {
    throw new Error(`Desktop asset reference must start with ./assets/: ${reference}`)
  }
  const assetPath = path.resolve(path.dirname(indexPath), reference)
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Desktop asset reference points to a missing file: ${reference}`)
  }
}

console.log(`Verified ${assetReferences.length} desktop asset reference(s).`)
