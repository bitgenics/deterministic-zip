# deterministic-zip

Regular zip binaries and libraries often generate different zip files from the same files most often because of metadata or timestamps. Deterministic-zip guarantees to always generate the same zip file every time.

This is a major problem when creating a reproducible build. The output from two builds from identical source would generate two different zip files.

With deterministic-zip you are guaranteed to get the exact same file every time you build from the same input.

# Usage

## Install

`npm install deterministic-zip --save`

## Zip

```javascript
const zip = require('deterministic-zip');

zip('data', 'test.zip', {includes: ['./index.js', './src/**'], cwd: 'data'}, (err) => {
    console.log('Done!');
});
```

## Warning

This is a very new library. I use it myself, but it has not been extensively test across multiple platforms, especially Windows. 
