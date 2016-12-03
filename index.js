const fs = require('fs');
const path = require('path');
const async = require('async');
const DeflateCRC32Stream = require('crc32-stream').DeflateCRC32Stream;
const minimatch = require("minimatch")

const shouldInclude2 = (file, options) => {
	const include = options.includes.find((pattern) => minimatch(file, pattern, {matchBase: true}));
	if(include) {
		const exclude = options.excludes.find((pattern) => minimatch(file, pattern, {matchBase: true, debug: true}));
		return include && !exclude
	} else {
		return false
	}
}

const addDir = (list, options, dir, callback) => {
	fs.readdir(dir, {}, (err, files) => {
		const dirs = []
		if(err) return callback(err);
		files.forEach((elem) => {
			file = dir + '/' + elem;
			const info = fs.statSync(file);
			info.relativePath = path.relative(options.cwd, file);
			const check = info.isDirectory() ? './' + info.relativePath + '/' : './' + info.relativePath;
			if(shouldInclude2(check, options)) {
				info.filename = elem
				info.absolutePath = path.resolve(file);
				list.push(info);	
			}
			if (info.isDirectory()) {
				dirs.push(file);
			}
		})
		async.each(dirs, async.apply(addDir, list, options), callback);
	})
}

const getFiles = (dir, options, callback) => {
	const files = []
	addDir(files, options, dir, (err) => {
		callback(undefined, files);
	})
}

const initFileHeaderTempl = () => {
	const headerTempl = Buffer.alloc(30, 0);
	headerTempl.writeInt32LE(0x04034b50, 0); //signature
	headerTempl.writeInt16LE(20, 4 ); //extractVersion
	headerTempl.writeInt16LE(0x808, 6); //bitflag (Data Descriptor + UTF8)
	headerTempl.writeInt16LE(8, 8); //compressionType
	headerTempl.writeInt16LE(0x6020, 10); //ModTime 12:01pm
	headerTempl.writeInt16LE(0x21, 12); //ModDate 1980/1/1
	return headerTempl
}

const initDirectoryHeaderTempl = () => {
	const headerTempl = Buffer.alloc(30, 0);
	headerTempl.writeInt32LE(0x04034b50, 0); //signature
	headerTempl.writeInt16LE(20, 4 ); //extractVersion
	headerTempl.writeInt16LE(0b1000, 6); //bitflag (Data Descriptor + UTF8)
	headerTempl.writeInt16LE(0, 8); //compressionType
	headerTempl.writeInt16LE(0x6020, 10); //ModTime 12:01pm
	headerTempl.writeInt16LE(0x21, 12); //ModDate 1980/1/1
	return headerTempl
}

const initFileCentralDirTempl = () => {
	const directoryHeader = Buffer.alloc(46, 0);
	directoryHeader.writeInt32LE(0x02014b50, 0); //signature
	directoryHeader.writeInt16LE(20, 6 ); //extractVersion
	directoryHeader.writeInt16LE(0x808, 8); //bitflag (Data Descriptor + UTF8)
	directoryHeader.writeInt16LE(8, 10); //compressionType
	directoryHeader.writeInt16LE(0x6020, 12); //ModTime 12:01pm
	directoryHeader.writeInt16LE(0x21, 14); //ModDate 1980/1/1
	return directoryHeader;
}

const initDirectoryCentralDirTempl = () => {
	const directoryHeader = Buffer.alloc(46, 0);
	directoryHeader.writeInt32LE(0x02014b50, 0); //signature
	directoryHeader.writeInt16LE(20, 6 ); //extractVersion
	directoryHeader.writeInt16LE(0b1000, 8); //bitflag (Data Descriptor + UTF8)
	directoryHeader.writeInt16LE(0, 10); //compressionType
	directoryHeader.writeInt16LE(0x6020, 12); //ModTime 12:01pm
	directoryHeader.writeInt16LE(0x21, 14); //ModDate 1980/1/1
	return directoryHeader;
}

class Zipfile {
	constructor(files, zipfile) {
		this.index = 0;
		files.sort((a, b) => {
			return a.relativePath.toUpperCase() > b.relativePath.toUpperCase()
		});
		this.fileObjects = files;
		this.outputStream = fs.createWriteStream(zipfile);
		this.fileheaderTempl = initFileHeaderTempl();
		this.directoryHeaderTempl = initDirectoryHeaderTempl();
		this.fileCentralDirTempl = initFileCentralDirTempl();
		this.directoryCentralDirTempl = initDirectoryCentralDirTempl();
	}

	_write(buffer, callback) {
		this.index += buffer.length;
		this.outputStream.write(buffer, callback);
	}

	_getHeaderBuffers(file) {
		const headerTempl = file.isDirectory() ? this.directoryHeaderTempl : this.fileheaderTempl;
		const filenameBuffer = Buffer.from(file.relativePath, 'utf8');
		headerTempl.writeInt16LE(filenameBuffer.length, 26);
		return [headerTempl, filenameBuffer]
	}

	_writeFileHeader(file, callback) {
		const fileheaderBuffers = this._getHeaderBuffers(file);
		async.eachSeries(fileheaderBuffers, (buffer, cb) => { this._write(buffer, cb) }, callback);
	}

	_writeDataDescriptor(file, callback) {
		const dataDescriptor = Buffer.alloc(16)
		dataDescriptor.writeInt32LE(0x08074b50, 0); //signature
		dataDescriptor.writeUIntLE(file.checksum, 4, 4); //crc-32
		dataDescriptor.writeInt32LE(file.compressedSize, 8); //compressed size
		dataDescriptor.writeInt32LE(file.uncompressedSize, 12); //uncompressed size
		this._write(dataDescriptor, callback);
	}

	_writeEntry(file, callback) {
		file.headerOffset = this.index;
		this._writeFileHeader(file, (err) => {
			if(err) return callback(err);
			if(file.isFile() ) {
				const readStream = fs.createReadStream(file.absolutePath);
				const checksum = new DeflateCRC32Stream();
				checksum.on('end', () => {
					file.checksum = checksum.digest();
					file.uncompressedSize = checksum.size();
					file.compressedSize = checksum.size(true);
					this.index += checksum.size(true); //add uncompressed size to index
					this._writeDataDescriptor(file, callback)
				})
				readStream.pipe(checksum).pipe(this.outputStream, {end: false});
			} else {
				file.checksum = 0;
				file.uncompressedSize = 0;
				file.compressedSize = 0;
				callback();
			}
		})
	}

	_writeDirectoryEntry(file, callback) {
		const directoryTempl = file.isDirectory() ? this.directoryCentralDirTempl : this.fileCentralDirTempl;
		const filenameBuffer = Buffer.from(file.relativePath, 'utf8')
		directoryTempl.writeUIntLE(file.checksum, 16, 4); //crc-32
		directoryTempl.writeInt32LE(file.compressedSize, 20); //compressedSize
		directoryTempl.writeInt32LE(file.uncompressedSize, 24); //uncompressedSize
		directoryTempl.writeInt16LE(filenameBuffer.length, 28); //filename length
		directoryTempl.writeInt32LE(file.headerOffset, 42);
		const buffers = [directoryTempl, filenameBuffer]
		async.eachSeries(buffers, (buffer, cb) => { this._write(buffer, cb) }, callback);
	}

	_writeEndRecord(callback) {
		const directorySize = this.index - this.directoryOffset;
		const endRecord = Buffer.alloc(22, 0);
		endRecord.writeInt32LE(0x06054b50, 0)
		endRecord.writeInt16LE(this.fileObjects.length, 8); //entries on disk
		endRecord.writeInt16LE(this.fileObjects.length, 10); //total entries
		endRecord.writeInt32LE(directorySize, 12); //size directory
		endRecord.writeInt32LE(this.directoryOffset, 16); //directory offset
		this._write(endRecord, callback);
	}

	zip(callback) {
		async.eachSeries(this.fileObjects, (file, cb) => {
			this._writeEntry(file, cb);
		}, (err) => {
			this.directoryOffset = this.index;
			async.eachSeries(this.fileObjects, (file, cb) => {
				this._writeDirectoryEntry(file, cb);
			}, (err) => {
				this._writeEndRecord((err) => {
					this.outputStream.close();
					callback();
				});
			})
		});
	}
}

zip = (dir, destination, options, callback) => {
	if(callback === undefined) {
		callback = options;
		options = {}
	}
	options.includes = options.includes || ['./**']
	options.excludes = options.excludes || ['.git', 'CVS', '.svn', '.hg', '.lock-wscript', '.wafpickle-N', '*.swp', '.DS_Store', '._*', 'npm-debug.log']
	options.cwd = options.cwd || '.';
	getFiles(dir, options , (err, files) => {
		zipfile = new Zipfile(files, destination);
		zipfile.zip(callback);
	})	
}

module.exports = zip