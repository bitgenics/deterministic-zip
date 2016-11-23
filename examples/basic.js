const zip = require('../index.js');

zip('data', 'test.zip', {includes: ['*.js'], cwd: 'data'}, (err) => {
	console.log('Done!');
});