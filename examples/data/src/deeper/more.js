const zip = require('../index.js');

zip('test', 'test.zip', {includes: ['./index.js', './src/**']}, (err) => {
	console.log('Done!');
});